import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from 'ffmpeg-static';
import ffprobeInstaller from 'ffprobe-static';
import { promisify } from 'util';
import { exec } from 'child_process';

// Configure paths
ffmpeg.setFfmpegPath(ffmpegInstaller);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

const execAsync = promisify(exec);

// Global status object (in-memory)
let jobStatus = {
  active: false,
  progress: 0,
  step: 'idle', // 'analyzing', 'processing', 'merging'
  message: '',
  error: null,
  outputFile: null
};

// Clean temp folder
const cleanTemp = (tempDir) => {
  if (fs.existsSync(tempDir)) {
    const files = fs.readdirSync(tempDir);
    for (const file of files) {
      fs.unlinkSync(path.join(tempDir, file));
    }
  }
};

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json(jobStatus);
  }

  if (req.method === 'POST') {
    if (jobStatus.active) {
      return res.status(409).json({ error: 'Job already in progress' });
    }

    const joinDir = path.join(process.cwd(), 'arquivos', 'join');
    const outputDir = path.join(process.cwd(), 'arquivos', 'final');
    const tempDir = path.join(process.cwd(), 'arquivos', 'temp');

    if (!fs.existsSync(joinDir)) {
      fs.mkdirSync(joinDir, { recursive: true });
    }
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Get files
    const files = fs.readdirSync(joinDir)
      .filter(f => !f.startsWith('.') && (f.endsWith('.mp4') || f.endsWith('.mov') || f.endsWith('.mkv')))
      .sort((a, b) => a.localeCompare(b)); // Alphabetical order

    if (files.length === 0) {
      return res.status(404).json({ error: 'No video files found in arquivos/join' });
    }

    // Initialize Job
    jobStatus = {
      active: true,
      progress: 0,
      step: 'initializing',
      message: 'Starting job...',
      error: null,
      outputFile: null
    };

    // Start background process
    processVideos(files, joinDir, outputDir, tempDir);

    return res.status(200).json({ message: 'Processing started', jobStatus });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

async function processVideos(files, joinDir, outputDir, tempDir) {
  try {
    cleanTemp(tempDir);
    let allSegments = [];
    let globalSegmentIndex = 0;

    // --- Step 1: Analysis & Silence Detection ---
    for (let i = 0; i < files.length; i++) {
      const fileName = files[i];
      const filePath = path.join(joinDir, fileName);

      jobStatus.message = `Analyzing ${fileName} (${i + 1}/${files.length})...`;
      jobStatus.step = 'analyzing';
      jobStatus.progress = Math.round((i / files.length) * 30); // 0-30% for analysis

      const segments = await detectNonSilentSegments(filePath);

      // Store segment info with file reference
      segments.forEach(seg => {
        allSegments.push({
          file: filePath,
          start: seg.start,
          end: seg.end,
          duration: seg.end - seg.start,
          originalIndex: i
        });
      });
    }

    // --- Step 2: Processing Clips (Zoom effect) ---
    jobStatus.step = 'processing';
    const processedClips = [];
    const totalDuration = allSegments.reduce((acc, cur) => acc + cur.duration, 0);
    let processedDuration = 0;

    for (let i = 0; i < allSegments.length; i++) {
      const seg = allSegments[i];
      const isZoom = i % 2 !== 0; // Alternate: Normal, Zoom, Normal, Zoom...
      const tempClipName = `clip_${String(i).padStart(5, '0')}.mp4`;
      const tempClipPath = path.join(tempDir, tempClipName);

      jobStatus.message = `Processing segment ${i + 1}/${allSegments.length} ${isZoom ? '(Zoom)' : '(Normal)'}`;

      await createSegmentClip(seg, tempClipPath, isZoom);
      processedClips.push(tempClipPath);

      processedDuration += seg.duration;
      // Map 30% -> 90%
      jobStatus.progress = 30 + Math.round((processedDuration / totalDuration) * 60);
    }

    // --- Step 3: Concatenation ---
    jobStatus.step = 'merging';
    jobStatus.message = 'Merging all clips...';

    const concatListPath = path.join(tempDir, 'filelist.txt');
    const fileContent = processedClips.map(p => `file '${p}'`).join('\n');
    fs.writeFileSync(concatListPath, fileContent);

    const outputFileName = `joined_${Date.now()}.mp4`;
    const finalOutputPath = path.join(outputDir, outputFileName);

    await concatClips(concatListPath, finalOutputPath);

    // Cleanup
    cleanTemp(tempDir);

    jobStatus.progress = 100;
    jobStatus.message = 'Done!';
    jobStatus.active = false;
    jobStatus.outputFile = outputFileName;

  } catch (err) {
    console.error("Processing Error:", err);
    jobStatus.error = err.message;
    jobStatus.active = false;
    jobStatus.step = 'error';
  }
}

// Helper: Detect silence and return "Keep" segments
function detectNonSilentSegments(filePath) {
  return new Promise((resolve, reject) => {
    // silence threshold: -30dB, duration: 0.5s (adjust as needed)
    // We parse the output to find silence_start and silence_end

    // Using fluent-ffmpeg to run silencedetect
    // We output to null and parse stderr
    const silenceData = [];
    let duration = 0;

    ffmpeg(filePath)
      .audioFilters('silencedetect=noise=-30dB:d=0.5')
      .format('null') // null output format just runs filters
      .output('-')    // output to stdout (ignored)
      .on('stderr', (line) => {
         // Parse Duration
         if (line.includes('Duration:')) {
            const match = line.match(/Duration: (\d{2}):(\d{2}):(\d{2}\.\d{2})/);
            if (match) {
                duration = parseFloat(match[1]) * 3600 + parseFloat(match[2]) * 60 + parseFloat(match[3]);
            }
         }
         // Parse Silence
         if (line.includes('silence_start:')) {
           const match = line.match(/silence_start: ([\d.]+)/);
           if (match) silenceData.push({ type: 'start', time: parseFloat(match[1]) });
         }
         else if (line.includes('silence_end:')) {
           const match = line.match(/silence_end: ([\d.]+)/);
           // Find the last start and pair it? Or just push end.
           // Usually silence_start comes before silence_end.
           // However, if video starts with silence?
           // silence_end might appear first if start was 0 (sometimes logged differently).
           if (match) silenceData.push({ type: 'end', time: parseFloat(match[1]) });
         }
      })
      .on('end', () => {
        // Calculate Keep Segments from Silence Segments
        // Logic:
        // Video: [0 ---------------------------------------- Duration]
        // Silence:      [S1------E1]       [S2----E2]
        // Keep:  [0-----S1]      [E1-------S2]    [E2-------Duration]

        let keepSegments = [];
        let currentPos = 0;

        // Sort silence markers by time just in case
        silenceData.sort((a, b) => a.time - b.time);

        let currentSilenceStart = null;

        for (const evt of silenceData) {
            if (evt.type === 'start') {
                if (currentSilenceStart === null) {
                    currentSilenceStart = evt.time;
                    // We found start of silence, so [currentPos -> currentSilenceStart] is valid audio
                    if (currentSilenceStart > currentPos + 0.1) { // 0.1s buffer
                        keepSegments.push({ start: currentPos, end: currentSilenceStart });
                    }
                }
            } else if (evt.type === 'end') {
                if (currentSilenceStart !== null) {
                    // End of silence. Update currentPos to this end.
                    currentPos = evt.time;
                    currentSilenceStart = null;
                } else {
                    // Silence end without start? Means silence started at 0.
                    currentPos = evt.time;
                }
            }
        }

        // Add final segment if there is audio after last silence
        if (currentPos < duration - 0.1) {
            keepSegments.push({ start: currentPos, end: duration });
        }

        // If no silence found at all, keep whole video
        if (silenceData.length === 0 && duration > 0) {
            keepSegments.push({ start: 0, end: duration });
        }

        resolve(keepSegments);
      })
      .on('error', reject)
      .run();
  });
}

// Helper: Create a single clip (with optional zoom)
function createSegmentClip(seg, outputPath, applyZoom) {
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg(seg.file)
      .seekInput(seg.start)
      .duration(seg.end - seg.start)
      .outputOptions([
          '-c:v libx264',
          '-pix_fmt yuv420p', // Ensure compatibility
          '-preset ultrafast', // Fast encoding for preview/tools
          '-c:a aac',
          '-ar 44100', // Standardize audio
          '-ac 2'      // Standardize audio channels
      ]);

    // Apply Zoom Filter if needed
    // Zoom 10%: scale to 110% height (keep aspect), then crop center to original
    if (applyZoom) {
        // We use a complex filter to ensure we get the input dimensions right?
        // Actually, simple filter string works well if we assume standard inputs or use relative values.
        // scale=-2:1.1*ih -> height becomes 1.1x, width auto-calculated to maintain aspect ratio (will be 1.1x width).
        // crop=iw:ih -> crops the original width/height from the center of the scaled video.
        // Setsar=1 ensures pixel aspect ratio is square.
        cmd.videoFilters('scale=-2:1.1*ih,crop=iw/1.1:ih/1.1,setsar=1');
    } else {
        // Just ensure SAR is 1 to avoid concat issues if input differs slightly
        cmd.videoFilters('setsar=1');
    }

    cmd
      .output(outputPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

// Helper: Concat clips
function concatClips(listPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(listPath)
      .inputOptions(['-f concat', '-safe 0'])
      .outputOptions(['-c copy']) // Stream copy for speed since we encoded segments uniformly
      .output(outputPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}
