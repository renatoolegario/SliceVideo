const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

// Configura o caminho do ffmpeg (usando ffmpeg-static)
if (ffmpegPath) {
    ffmpeg.setFfmpegPath(ffmpegPath);
}

// pasta onde os vídeos enviados serão salvos
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

const upload = multer({ dest: uploadDir });

// servir arquivos estáticos (HTML, CSS, JS)
app.use(express.static(path.join(__dirname, 'public')));

// rota para processar o vídeo
app.post('/processar', upload.single('video'), (req, res) => {
    const file = req.file;
    let durationPerClip = parseInt(req.body.duration, 10);

    if (!file) {
        return res.status(400).json({ error: 'Nenhum vídeo enviado.' });
    }

    if (isNaN(durationPerClip) || durationPerClip <= 0) {
        durationPerClip = 60; // default 60s
    }

    const inputPath = file.path;
    const ext = path.extname(file.originalname) || '.mp4';
    const baseName = path.basename(file.originalname, ext);
    const outputDir = path.dirname(inputPath); // mesma pasta do "original" (uploads)

    // 1) Descobrir a duração total do vídeo
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
        if (err) {
            console.error('Erro ao ler metadata:', err);
            return res.status(500).json({ error: 'Erro ao ler informações do vídeo.' });
        }

        const totalSeconds = Math.floor(metadata.format.duration);
        const numParts = Math.ceil(totalSeconds / durationPerClip);

        console.log(`Duração total: ${totalSeconds}s, partes: ${numParts}`);

        const outputFiles = [];

        // Função que cria um corte (Promise)
        const createClip = (index) => {
            return new Promise((resolve, reject) => {
                const startTime = index * durationPerClip;
                const clipName = `${baseName}_${String(index + 1).padStart(2, '0')}${ext}`;
                const outputPath = path.join(outputDir, clipName);

                ffmpeg(inputPath)
                    .setStartTime(startTime)
                    .setDuration(durationPerClip)
                    .output(outputPath)
                    .on('end', () => {
                        console.log(`Criado: ${clipName}`);
                        outputFiles.push(clipName);
                        resolve();
                    })
                    .on('error', (error) => {
                        console.error(`Erro no corte ${index + 1}:`, error);
                        reject(error);
                    })
                    .run();
            });
        };

        // 2) Criar todas as partes em sequência
        const jobs = [];
        for (let i = 0; i < numParts; i++) {
            jobs.push(createClip(i));
        }

        Promise.all(jobs)
            .then(() => {
                // se quiser, pode apagar o arquivo enviado:
                // fs.unlinkSync(inputPath);

                res.json({
                    message: 'Vídeo cortado com sucesso!',
                    partes: outputFiles,
                    pasta: outputDir,
                });
            })
            .catch((error) => {
                console.error('Erro geral:', error);
                res.status(500).json({ error: 'Erro ao cortar o vídeo.' });
            });
    });
});

app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});
