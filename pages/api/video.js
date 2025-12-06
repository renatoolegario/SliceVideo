import fs from 'fs';
import path from 'path';

export const config = {
  api: {
    responseLimit: false,
  },
};

export default function handler(req, res) {
  const originalDir = path.join(process.cwd(), 'arquivos', 'original');

  if (!fs.existsSync(originalDir)) {
    return res.status(404).json({ error: 'Directory not found' });
  }

  const files = fs.readdirSync(originalDir).filter(file => {
    return !file.startsWith('.'); // Ignore hidden files
  });

  if (files.length === 0) {
    return res.status(404).json({ error: 'No video files found' });
  }

  const videoPath = path.join(originalDir, files[0]);
  const stat = fs.statSync(videoPath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = (end - start) + 1;
    const file = fs.createReadStream(videoPath, { start, end });
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': 'video/mp4',
    };
    res.writeHead(206, head);
    file.pipe(res);
  } else {
    const head = {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
    };
    res.writeHead(200, head);
    fs.createReadStream(videoPath).pipe(res);
  }
}
