import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from 'ffmpeg-static';
import ffprobeInstaller from 'ffprobe-static';

ffmpeg.setFfmpegPath(ffmpegInstaller);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

// Simple in-memory store for progress.
// Note: This is global to the module, so it resets on server restart and is shared across all requests.
// For a single-user local tool, this is acceptable.
let jobStatus = {
  active: false,
  progress: 0,
  message: '',
  error: null
};

export default function handler(req, res) {
  console.log(`[API] ${req.method} /api/process`);

  if (req.method === 'GET') {
    return res.status(200).json(jobStatus);
  }

  if (req.method === 'POST') {
    console.log('[API] Received POST request to start processing');
    if (jobStatus.active) {
      console.warn('[API] Job already in progress');
      return res.status(409).json({ error: 'Job already in progress' });
    }

    const { seconds } = req.body;
    const splitDuration = parseInt(seconds) || 60;

    const originalDir = path.join(process.cwd(), 'arquivos', 'original');
    const outputDir = path.join(process.cwd(), 'arquivos', 'novosVideos');

    if (!fs.existsSync(originalDir)) {
      return res.status(404).json({ error: 'Original directory not found' });
    }

    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const files = fs.readdirSync(originalDir).filter(f => !f.startsWith('.'));
    if (files.length === 0) {
      return res.status(404).json({ error: 'No video files found in original folder' });
    }

    const inputFile = path.join(originalDir, files[0]);
    const originalFileName = path.parse(files[0]).name;

    jobStatus = {
      active: true,
      progress: 0,
      message: 'Starting processing...',
      error: null
    };

    // Start processing in the "background" (as much as Node allows without workers)
    // In Vercel/Serverless this would time out, but for `npm run dev` it works.
    console.log(`[API] Starting processVideo for ${inputFile}`);
    processVideo(inputFile, outputDir, splitDuration, originalFileName);

    return res.status(200).json({ message: 'Processing started', jobStatus });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

async function processVideo(inputFile, outputDir, splitDuration, originalFileName) {
  try {
    console.log('[ProcessVideo] Started');
    // 1. Get Duration
    jobStatus.message = 'Getting video info...';

    ffmpeg.ffprobe(inputFile, (err, metadata) => {
      if (err) {
        console.error('[ProcessVideo] ffprobe error:', err);
        jobStatus.error = err.message;
        jobStatus.active = false;
        return;
      }

      const totalDuration = metadata.format.duration;
      console.log(`[ProcessVideo] Duration: ${totalDuration}, Split: ${splitDuration}`);
      jobStatus.message = `Total duration: ${totalDuration}s. Splitting every ${splitDuration}s...`;

      // Calculate number of segments
      const segmentCount = Math.ceil(totalDuration / splitDuration);

      // We will loop and create segments.
      // Note: ffmpeg segment muxer is more efficient but 'fluent-ffmpeg' loop is easier to reason about
      // for specific "delete original" requirements and file naming if we want strict control.
      // However, the 'segment' muxer is much faster and cleaner. Let's use the segment muxer.

      const outputPattern = path.join(outputDir, `${originalFileName}_%03d.mp4`);

      ffmpeg(inputFile)
        .outputOptions([
          '-c copy', // Copy stream to avoid re-encoding (fast)
          '-map 0',
          '-f segment',
          `-segment_time ${splitDuration}`,
          '-reset_timestamps 1'
        ])
        .output(outputPattern)
        .on('progress', (progress) => {
          // progress.percent is sometimes undefined for segment muxer with copy,
          // but we can try to use timemark or just generic "processing".
          // If we re-encode, we get percent. Copying is instant usually.
          // Let's assume copying is fast enough that progress bar jumps to 100 quickly.
          if (progress.percent) {
             console.log(`[ProcessVideo] Progress: ${progress.percent}%`);
             jobStatus.progress = progress.percent;
          } else {
             // Fallback if percent is missing (common with -c copy)
             console.log(`[ProcessVideo] Progress Timemark: ${progress.timemark}`);
             jobStatus.message = `Processing... Timemark: ${progress.timemark}`;
          }
        })
        .on('end', () => {
          console.log('[ProcessVideo] Splitting complete');
          jobStatus.progress = 100;
          jobStatus.message = 'Splitting complete. Deleting original...';

          try {
            fs.unlinkSync(inputFile);
            console.log('[ProcessVideo] Original file deleted');
            jobStatus.message = 'Done. Original deleted.';
            jobStatus.active = false;
          } catch (delErr) {
            console.error('[ProcessVideo] Failed to delete original:', delErr);
            jobStatus.error = `Failed to delete original: ${delErr.message}`;
            jobStatus.active = false;
          }
        })
        .on('error', (err) => {
          console.error('[ProcessVideo] FFmpeg error:', err);
          jobStatus.error = err.message;
          jobStatus.active = false;
        })
        .run();
    });

  } catch (error) {
    console.error('[ProcessVideo] Unexpected error:', error);
    jobStatus.error = error.message;
    jobStatus.active = false;
  }
}
