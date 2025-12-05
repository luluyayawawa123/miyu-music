const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const mm = require('music-metadata');

const app = express();
const PORT = process.env.PORT || 3337;
// 设置系统密码，实际应用中应存储加密后的密码并使用更安全的方式
const SYSTEM_PASSWORD = 'miyu2024';

// --- Middleware ---
// 启用 JSON 请求体解析
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- 自定义音频流媒体路由 (必须在静态文件服务之前) ---
// 这个路由优化了MP3等格式的流媒体传输，解决慢网速下缓冲时间过长的问题
app.get('/music/:filename', (req, res) => {
    try {
        const filename = decodeURIComponent(req.params.filename);
        const filePath = path.join(__dirname, 'music', filename);

        // 检查文件是否存在
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: '音频文件不存在' });
        }

        const stat = fs.statSync(filePath);
        const fileSize = stat.size;
        const ext = path.extname(filename).toLowerCase();

        // 根据文件扩展名设置正确的 MIME 类型
        const mimeTypes = {
            '.mp3': 'audio/mpeg',
            '.wav': 'audio/wav',
            '.ogg': 'audio/ogg',
            '.m4a': 'audio/mp4',
            '.aac': 'audio/aac',
            '.flac': 'audio/flac',
            '.webm': 'audio/webm'
        };
        const contentType = mimeTypes[ext] || 'application/octet-stream';

        // 处理 Range 请求（分块传输）
        const range = req.headers.range;

        if (range) {
            // 解析 Range 头
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            // 使用 1MB 作为默认 chunk 大小，优化流媒体传输
            const CHUNK_SIZE = 1024 * 1024; // 1MB
            const end = parts[1]
                ? parseInt(parts[1], 10)
                : Math.min(start + CHUNK_SIZE - 1, fileSize - 1);

            // 验证 Range 有效性
            if (start >= fileSize || end >= fileSize || start > end) {
                res.status(416).set({
                    'Content-Range': `bytes */${fileSize}`
                });
                return res.end();
            }

            const chunkSize = end - start + 1;

            // 设置响应头
            res.status(206).set({
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunkSize,
                'Content-Type': contentType,
                'Cache-Control': 'public, max-age=31536000', // 缓存1年
                'X-Content-Duration': stat.size // 帮助某些播放器快速获取时长
            });

            // 创建文件流并传输
            const stream = fs.createReadStream(filePath, { start, end });
            stream.pipe(res);

            // 错误处理
            stream.on('error', (err) => {
                console.error(`流媒体传输错误 (${filename}):`, err);
                if (!res.headersSent) {
                    res.status(500).json({ error: '流媒体传输失败' });
                }
            });

        } else {
            // 没有 Range 请求，返回完整文件（但仍告知客户端支持 Range）
            res.set({
                'Content-Length': fileSize,
                'Content-Type': contentType,
                'Accept-Ranges': 'bytes',
                'Cache-Control': 'public, max-age=31536000'
            });

            const stream = fs.createReadStream(filePath);
            stream.pipe(res);

            stream.on('error', (err) => {
                console.error(`文件传输错误 (${filename}):`, err);
                if (!res.headersSent) {
                    res.status(500).json({ error: '文件传输失败' });
                }
            });
        }
    } catch (error) {
        console.error('音频流处理错误:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: '服务器内部错误' });
        }
    }
});

// Serve static files from 'public' directory (or root for html, css, js)
app.use(express.static(path.join(__dirname))); // Serves index.html from root
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/js', express.static(path.join(__dirname, 'js')));
// 注意：/music 的静态文件服务被上面的自定义路由覆盖，但保留作为后备
app.use('/music', express.static(path.join(__dirname, 'music')));

// Ensure music directory exists
// Ensure music directory exists
const musicDir = path.join(__dirname, 'music');
if (!fs.existsSync(musicDir)) {
    fs.mkdirSync(musicDir, { recursive: true });
}

const playlistFile = path.join(musicDir, 'playlist.json');

// 密码验证中间件
const verifyPassword = (req, res, next) => {
    const { password } = req.body;

    if (!password || password !== SYSTEM_PASSWORD) {
        return res.status(401).json({ error: '密码错误，操作被拒绝' });
    }

    next();
};

// --- Multer Setup for File Uploads ---
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, musicDir); // Save files to the 'music' directory
    },
    filename: function (req, file, cb) {
        // Handle Unicode filenames properly
        // Use Buffer to decode the originalname properly
        // This helps with Chinese characters and other non-ASCII characters
        let decodedFilename;
        try {
            // First try to decode to handle potential URL-encoded names
            decodedFilename = decodeURIComponent(file.originalname);
        } catch (e) {
            // If not URL-encoded, use the original
            decodedFilename = file.originalname;
        }

        // Generate a safe filename
        const safeFilename = Buffer.from(decodedFilename, 'latin1').toString('utf8');

        cb(null, safeFilename);
    }
});

const upload = multer({
    storage: storage,
    fileFilter: function (req, file, cb) {
        // Accept only audio files
        if (file.mimetype.startsWith('audio/')) {
            cb(null, true);
        } else {
            cb(new Error('仅支持上传音频文件!'), false);
        }
    }
});

// --- API Routes ---

// 密码验证API
app.post('/api/verify-password', (req, res) => {
    const { password } = req.body;

    if (password === SYSTEM_PASSWORD) {
        res.json({ verified: true });
    } else {
        res.status(401).json({ verified: false, error: '密码错误' });
    }
});

// GET: List all music files and their metadata
app.get('/api/music', async (req, res) => {
    try {
        const files = await fs.promises.readdir(musicDir, { encoding: 'utf8' });

        // Filter for audio files and get their stats (mtime)
        const musicFilesWithStats = await Promise.all(
            files
                .filter(file => {
                    const ext = path.extname(file).toLowerCase();
                    return ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac'].includes(ext);
                })
                .map(async file => {
                    const filePath = path.join(musicDir, file);
                    try {
                        const stats = await fs.promises.stat(filePath);
                        return { name: file, mtime: stats.mtimeMs };
                    } catch (e) {
                        return { name: file, mtime: 0 };
                    }
                })
        );

        let sortedFiles = musicFilesWithStats;

        // Try to read playlist order
        try {
            if (fs.existsSync(playlistFile)) {
                const playlistData = await fs.promises.readFile(playlistFile, 'utf8');
                // Basic check for empty file
                if (playlistData.trim()) {
                    const playlistOrder = JSON.parse(playlistData);

                    // Create a map for O(1) lookup of index
                    const orderMap = new Map(playlistOrder.map((file, index) => [file, index]));

                    // Sort:
                    // 1. Files not in playlist (index -1) come FIRST
                    // 2. Files in playlist (index >= 0) come AFTER, sorted by index
                    // 3. If both are new (index -1), sort by mtime DESC (newest first)

                    sortedFiles.sort((a, b) => {
                        const indexA = orderMap.has(a.name) ? orderMap.get(a.name) : -1;
                        const indexB = orderMap.has(b.name) ? orderMap.get(b.name) : -1;

                        if (indexA === -1 && indexB === -1) {
                            // Both are new, sort by time DESC
                            return b.mtime - a.mtime;
                        }

                        // If one is new (-1) and one is old (>=0), we want New to be First.
                        // Standard integer sort: -1 comes before 0. So no special logic needed besides subtraction.
                        // -1 - 0 = -1 (New before Old)
                        // 0 - -1 = 1 (Old after New)
                        return indexA - indexB;
                    });
                }
            } else {
                // No playlist file: Sort by time DESC (Newest uploads first) as default
                sortedFiles.sort((a, b) => b.mtime - a.mtime);
            }
        } catch (e) {
            console.error("Error reading playlist order:", e);
            // Fallback: Sort by time DESC
            sortedFiles.sort((a, b) => b.mtime - a.mtime);
        }

        // Process each file to get metadata (using sorted list)
        // Extract names from sorted objects
        const musicFiles = sortedFiles.map(f => f.name);

        const tracksWithMetadata = await Promise.all(musicFiles.map(async (file) => {
            const filePath = path.join(musicDir, file);
            try {
                // Use parseFile on the path
                const metadata = await mm.parseFile(filePath);
                const hasCover = metadata.common.picture && metadata.common.picture.length > 0;

                return {
                    name: file,
                    url: `/music/${encodeURIComponent(file)}`,
                    title: metadata.common.title || file,
                    artist: metadata.common.artist || '',
                    album: metadata.common.album || '',
                    hasCover: hasCover,
                    coverId: hasCover ? file : null
                };
            } catch (error) {
                console.error(`Error parsing metadata for ${file}:`, error);
                return {
                    name: file,
                    url: `/music/${encodeURIComponent(file)}`,
                    title: file,
                    hasCover: false
                };
            }
        }));

        res.json(tracksWithMetadata);
    } catch (err) {
        console.error("Error reading music directory:", err);
        return res.status(500).json({ error: '无法读取音乐列表' });
    }
});

// POST: Save playlist order
app.post('/api/playlist/order', async (req, res) => {
    try {
        const { order } = req.body;
        if (!Array.isArray(order)) {
            return res.status(400).json({ error: '无效的数据格式' });
        }

        await fs.promises.writeFile(playlistFile, JSON.stringify(order, null, 2), 'utf8');
        res.json({ success: true, message: '播放列表顺序已保存' });
    } catch (error) {
        console.error("Error saving playlist order:", error);
        res.status(500).json({ error: '无法保存播放列表顺序' });
    }
});

// GET: Get cover art for a specific track
app.get('/api/cover/:trackId', async (req, res) => {
    try {
        const trackId = decodeURIComponent(req.params.trackId);
        const filePath = path.join(musicDir, trackId);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: '找不到文件' });
        }

        const metadata = await mm.parseFile(filePath);

        if (!metadata.common.picture || metadata.common.picture.length === 0) {
            return res.status(404).json({ error: '没有封面图片' });
        }

        const picture = metadata.common.picture[0];
        res.set('Content-Type', picture.format);
        res.send(picture.data);
    } catch (error) {
        console.error("Error extracting cover art:", error);
        res.status(500).json({ error: '无法提取封面图片' });
    }
});

// POST: Upload a music file (with password verification)
app.post('/api/upload', upload.array('musicFiles', 20), (req, res, next) => {
    // 先解析文件，然后验证密码
    const { password } = req.body;

    if (!password || password !== SYSTEM_PASSWORD) {
        // 如果密码验证失败，删除已上传的文件
        if (req.files && req.files.length > 0) {
            req.files.forEach(file => {
                try {
                    fs.unlinkSync(file.path);
                } catch (err) {
                    console.error(`清理临时文件失败: ${file.path}`, err);
                }
            });
        }
        return res.status(401).json({ error: '密码错误，操作被拒绝' });
    }

    // 密码验证通过，继续处理
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: '没有文件被上传' });
    }

    const uploadedFiles = req.files.map(file => ({
        fileName: file.filename,
        path: `/music/${encodeURIComponent(file.filename)}`
    }));

    res.json({
        message: `${uploadedFiles.length} 个文件上传成功!`,
        files: uploadedFiles
    });
}, (error, req, res, next) => {
    // Global error handler for multer upload issues
    if (error instanceof multer.MulterError) {
        return res.status(400).json({ error: `上传错误: ${error.message}` });
    } else if (error) {
        return res.status(400).json({ error: error.message }); // Catches custom errors like file type
    }
    next();
});

// GET: Get detailed audio info for a specific track
app.get('/api/info/:trackId', async (req, res) => {
    try {
        const trackId = decodeURIComponent(req.params.trackId);
        const filePath = path.join(musicDir, trackId);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: '找不到文件' });
        }

        const stats = await fs.promises.stat(filePath);
        const metadata = await mm.parseFile(filePath);

        // 构建详细信息
        const info = {
            // 文件信息
            fileName: trackId,
            fileSize: stats.size,
            fileSizeFormatted: formatFileSize(stats.size),

            // 基础元数据
            title: metadata.common.title || trackId,
            artist: metadata.common.artist || '未知',
            album: metadata.common.album || '未知',
            year: metadata.common.year || '未知',
            genre: metadata.common.genre ? metadata.common.genre.join(', ') : '未知',

            // 音频格式
            format: metadata.format.container || '未知',
            codec: metadata.format.codec || '未知',
            codecProfile: metadata.format.codecProfile || '',

            // 音频参数
            duration: metadata.format.duration || 0,
            durationFormatted: formatDuration(metadata.format.duration),
            bitrate: metadata.format.bitrate || 0,
            bitrateFormatted: metadata.format.bitrate ? Math.round(metadata.format.bitrate / 1000) + ' kbps' : '未知',
            sampleRate: metadata.format.sampleRate || 0,
            sampleRateFormatted: metadata.format.sampleRate ? (metadata.format.sampleRate / 1000).toFixed(1) + ' kHz' : '未知',
            channels: metadata.format.numberOfChannels || 0,
            channelsFormatted: getChannelName(metadata.format.numberOfChannels),
            bitsPerSample: metadata.format.bitsPerSample || 0,

            // 标签信息
            trackNumber: metadata.common.track?.no || null,
            diskNumber: metadata.common.disk?.no || null,
            composer: metadata.common.composer ? metadata.common.composer.join(', ') : null,
            comment: metadata.common.comment ? metadata.common.comment[0] : null
        };

        res.json(info);
    } catch (error) {
        console.error("Error getting audio info:", error);
        res.status(500).json({ error: '无法获取音频信息' });
    }
});

// 辅助函数：格式化文件大小
function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 辅助函数：格式化时长
function formatDuration(seconds) {
    if (!seconds) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return mins + ':' + secs.toString().padStart(2, '0');
}

// 辅助函数：获取声道名称
function getChannelName(channels) {
    if (channels === 1) return '单声道';
    if (channels === 2) return '立体声';
    if (channels === 6) return '5.1 环绕声';
    return channels ? channels + ' 声道' : '未知';
}


// DELETE: Delete a music file (with password verification)
app.delete('/api/music/:fileName', verifyPassword, (req, res) => {
    try {
        const fileName = decodeURIComponent(req.params.fileName);
        const filePath = path.join(musicDir, fileName);

        // 检查文件是否存在
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: '文件不存在' });
        }

        // 删除文件
        fs.unlinkSync(filePath);

        res.json({
            success: true,
            message: `成功删除文件: ${fileName}`
        });
    } catch (error) {
        console.error('删除文件错误:', error);
        res.status(500).json({
            error: '删除文件时发生错误',
            details: error.message
        });
    }
});

// --- Server Start ---
app.listen(PORT, () => {
    console.log(`服务器运行在 http://localhost:${PORT}`);
    console.log(`音乐目录: ${musicDir}`)
}); 
