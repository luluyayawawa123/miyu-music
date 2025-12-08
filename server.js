const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const mm = require('music-metadata');
const { spawn } = require('child_process');

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
            // 使用 256KB 作为默认 chunk 大小，加快首次响应速度
            const CHUNK_SIZE = 256 * 1024; // 256KB - 慢网速下更快开始播放
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

// HLS 缓存目录
const hlsCacheDir = path.join(musicDir, '.hls-cache');
if (!fs.existsSync(hlsCacheDir)) {
    fs.mkdirSync(hlsCacheDir, { recursive: true });
}

// 封面图缓存目录
const coverCacheDir = path.join(musicDir, '.cover-cache');
if (!fs.existsSync(coverCacheDir)) {
    fs.mkdirSync(coverCacheDir, { recursive: true });
}

// 元数据缓存文件
const metadataCacheFile = path.join(musicDir, '.metadata-cache.json');
let metadataCache = {}; // 内存中的缓存 { filename: { title, artist, album, hasCover, mtime } }

// 加载元数据缓存
function loadMetadataCache() {
    try {
        if (fs.existsSync(metadataCacheFile)) {
            const data = fs.readFileSync(metadataCacheFile, 'utf8');
            metadataCache = JSON.parse(data);
            console.log(`已加载元数据缓存: ${Object.keys(metadataCache).length} 个文件`);
        }
    } catch (err) {
        console.error('加载元数据缓存失败:', err);
        metadataCache = {};
    }
}

// 保存元数据缓存（异步，不阻塞）
function saveMetadataCache() {
    fs.promises.writeFile(metadataCacheFile, JSON.stringify(metadataCache, null, 2), 'utf8')
        .catch(err => console.error('保存元数据缓存失败:', err));
}

// 获取单个文件的元数据（优先从缓存读取）
async function getFileMetadata(filename) {
    const filePath = path.join(musicDir, filename);

    try {
        const stat = await fs.promises.stat(filePath);
        const mtime = stat.mtimeMs;

        // 检查缓存是否有效（文件未被修改）
        if (metadataCache[filename] && metadataCache[filename].mtime === mtime) {
            return metadataCache[filename];
        }

        // 缓存无效或不存在，重新解析
        const metadata = await mm.parseFile(filePath);
        const hasCover = metadata.common.picture && metadata.common.picture.length > 0;

        const result = {
            name: filename,
            url: `/music/${encodeURIComponent(filename)}`,
            title: metadata.common.title || filename,
            artist: metadata.common.artist || '',
            album: metadata.common.album || '',
            hasCover: hasCover,
            coverId: hasCover ? filename : null,
            mtime: mtime
        };

        // 更新缓存
        metadataCache[filename] = result;

        return result;
    } catch (error) {
        console.error(`解析元数据失败 (${filename}):`, error);
        return {
            name: filename,
            url: `/music/${encodeURIComponent(filename)}`,
            title: filename,
            hasCover: false,
            mtime: 0
        };
    }
}

// 从缓存中删除文件的元数据
function removeFromMetadataCache(filename) {
    if (metadataCache[filename]) {
        delete metadataCache[filename];
        saveMetadataCache();
    }
}

// 删除封面缓存
function removeCoverCache(filename) {
    const safeFilename = filename.replace(/[^a-zA-Z0-9\u4e00-\u9fa5._-]/g, '_');
    const coverPath = path.join(coverCacheDir, safeFilename + '.jpg');
    if (fs.existsSync(coverPath)) {
        try {
            fs.unlinkSync(coverPath);
            console.log(`已删除封面缓存: ${safeFilename}`);
        } catch (e) { }
    }
}

// 启动时加载缓存
loadMetadataCache();

// HLS 缓存永久保留，只在删除源文件时清理对应缓存

// --- HLS 流媒体路由 (用于 iOS Safari) ---
// 将 M4A/WAV 等格式实时转码为 HLS 流
// 使用异步转码 + 状态轮询模式，避免 HTTP 超时

// 跟踪正在进行的转码任务
const transcodingTasks = new Map(); // filename -> { status: 'pending'|'transcoding'|'done'|'error', progress: 0-100, error: null }

// 启动转码任务（异步，不阻塞）
function startTranscoding(filename, filePath, cacheDir, playlistPath) {
    // 标记开始转码
    transcodingTasks.set(filename, { status: 'transcoding', progress: 0, error: null });

    console.log(`开始 HLS 转码: ${filename}`);

    // 计算 HLS 分段的 URL 前缀
    // 分段文件将通过 /hls/:filename/:segment 路由访问
    const hlsBaseUrl = `/hls/${encodeURIComponent(filename)}/`;

    const ffmpeg = spawn('ffmpeg', [
        '-i', filePath,
        '-c:a', 'aac',
        '-b:a', '192k',
        '-hls_time', '10',
        '-hls_list_size', '0',
        '-hls_segment_filename', path.join(cacheDir, 'segment%03d.ts'),
        '-hls_base_url', hlsBaseUrl,  // 设置分段文件的URL前缀
        '-progress', 'pipe:1',
        playlistPath
    ]);

    let ffmpegOutput = '';

    // 解析进度
    ffmpeg.stdout.on('data', (data) => {
        const output = data.toString();
        const match = output.match(/out_time_ms=(\d+)/);
        if (match) {
            const task = transcodingTasks.get(filename);
            if (task) {
                task.progress = Math.min(99, task.progress + 5);
            }
        }
    });

    ffmpeg.stderr.on('data', (data) => {
        ffmpegOutput += data.toString();
    });

    ffmpeg.on('close', (code) => {
        if (code === 0) {
            console.log(`HLS 转码完成: ${filename}`);

            // 验证 m3u8 文件内容（调试用）
            try {
                const m3u8Content = fs.readFileSync(playlistPath, 'utf8');
                console.log(`M3U8 内容预览:\n${m3u8Content.substring(0, 500)}`);
            } catch (e) { }

            transcodingTasks.set(filename, { status: 'done', progress: 100, error: null });
        } else {
            console.error(`FFmpeg 转码失败 (${filename}):`, ffmpegOutput);
            transcodingTasks.set(filename, { status: 'error', progress: 0, error: 'FFmpeg 转码失败' });
            try {
                fs.rmSync(cacheDir, { recursive: true, force: true });
            } catch (e) { }
        }
    });

    ffmpeg.on('error', (err) => {
        console.error('FFmpeg 启动失败:', err);
        transcodingTasks.set(filename, { status: 'error', progress: 0, error: 'FFmpeg 无法启动' });
    });
}

// HLS 状态检查 API
app.get('/hls-status/:filename', (req, res) => {
    try {
        const filename = decodeURIComponent(req.params.filename);
        const safeFilename = filename.replace(/[^a-zA-Z0-9\u4e00-\u9fa5._-]/g, '_');
        const cacheDir = path.join(hlsCacheDir, safeFilename);
        const playlistPath = path.join(cacheDir, 'playlist.m3u8');

        // 检查是否已有完成的缓存
        if (fs.existsSync(playlistPath)) {
            return res.json({ status: 'done', progress: 100 });
        }

        // 检查转码状态
        const task = transcodingTasks.get(filename);
        if (task) {
            return res.json(task);
        }

        // 没有转码任务，返回未开始状态
        return res.json({ status: 'pending', progress: 0 });
    } catch (error) {
        console.error('HLS 状态检查错误:', error);
        res.status(500).json({ status: 'error', error: '服务器错误' });
    }
});

// HLS 主请求路由
app.get('/hls/:filename', (req, res) => {
    try {
        const filename = decodeURIComponent(req.params.filename);
        const filePath = path.join(musicDir, filename);

        // 检查源文件是否存在
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: '音频文件不存在' });
        }

        // 为每个文件创建独立的缓存目录
        const safeFilename = filename.replace(/[^a-zA-Z0-9\u4e00-\u9fa5._-]/g, '_');
        const cacheDir = path.join(hlsCacheDir, safeFilename);
        const playlistPath = path.join(cacheDir, 'playlist.m3u8');

        // 检查是否已有缓存的 HLS 文件
        if (fs.existsSync(playlistPath)) {
            // 更新缓存目录的修改时间（延长缓存有效期）
            const now = new Date();
            try { fs.utimesSync(cacheDir, now, now); } catch (e) { }

            res.set({
                'Content-Type': 'application/vnd.apple.mpegurl',
                'Cache-Control': 'no-cache'
            });
            return res.sendFile(playlistPath);
        }

        // 检查是否正在转码
        const task = transcodingTasks.get(filename);
        if (task) {
            if (task.status === 'transcoding') {
                // 正在转码，告诉客户端等待
                return res.status(202).json({
                    status: 'transcoding',
                    progress: task.progress,
                    message: '正在转码，请稍候...'
                });
            } else if (task.status === 'error') {
                // 转码失败，清除状态让用户可以重试
                transcodingTasks.delete(filename);
                return res.status(500).json({ error: task.error || 'HLS 转码失败' });
            }
            // status === 'done' 但文件不存在？重新转码
        }

        // 创建缓存目录
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true });
        }

        // 启动异步转码
        startTranscoding(filename, filePath, cacheDir, playlistPath);

        // 立即返回，告诉客户端转码已开始
        return res.status(202).json({
            status: 'transcoding',
            progress: 0,
            message: '开始转码...'
        });

    } catch (error) {
        console.error('HLS 流处理错误:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: '服务器内部错误' });
        }
    }
});

// HLS 分段文件路由
app.get('/hls/:filename/:segment', (req, res) => {
    try {
        const filename = decodeURIComponent(req.params.filename);
        const segment = req.params.segment;

        // 安全检查：确保 segment 只是文件名
        if (segment.includes('/') || segment.includes('\\') || segment.includes('..')) {
            return res.status(400).json({ error: '无效的请求' });
        }

        const safeFilename = filename.replace(/[^a-zA-Z0-9\u4e00-\u9fa5._-]/g, '_');
        const segmentPath = path.join(hlsCacheDir, safeFilename, segment);

        if (!fs.existsSync(segmentPath)) {
            return res.status(404).json({ error: '分段文件不存在' });
        }

        res.set({
            'Content-Type': 'video/MP2T',
            'Cache-Control': 'public, max-age=31536000'
        });
        res.sendFile(segmentPath);

    } catch (error) {
        console.error('HLS 分段文件错误:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: '服务器内部错误' });
        }
    }
});

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

        // Process each file to get metadata (using cache)
        const musicFiles = sortedFiles.map(f => f.name);

        const tracksWithMetadata = await Promise.all(
            musicFiles.map(filename => getFileMetadata(filename))
        );

        // 保存缓存（异步，不阻塞响应）
        saveMetadataCache();

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

// GET: Get cover art for a specific track (with caching)
app.get('/api/cover/:trackId', async (req, res) => {
    try {
        const trackId = decodeURIComponent(req.params.trackId);
        const filePath = path.join(musicDir, trackId);

        // 生成缓存文件名
        const safeFilename = trackId.replace(/[^a-zA-Z0-9\u4e00-\u9fa5._-]/g, '_');
        const coverCachePath = path.join(coverCacheDir, safeFilename + '.jpg');

        // 检查缓存是否存在
        if (fs.existsSync(coverCachePath)) {
            res.set({
                'Content-Type': 'image/jpeg',
                'Cache-Control': 'public, max-age=31536000' // 缓存1年
            });
            return res.sendFile(coverCachePath);
        }

        // 缓存不存在，从音频文件提取
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: '找不到文件' });
        }

        const metadata = await mm.parseFile(filePath);

        if (!metadata.common.picture || metadata.common.picture.length === 0) {
            return res.status(404).json({ error: '没有封面图片' });
        }

        const picture = metadata.common.picture[0];

        // 保存到缓存（异步，不阻塞响应）
        fs.promises.writeFile(coverCachePath, picture.data)
            .then(() => console.log(`已缓存封面: ${safeFilename}`))
            .catch(err => console.error(`缓存封面失败:`, err));

        res.set({
            'Content-Type': picture.format,
            'Cache-Control': 'public, max-age=31536000'
        });
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
    if (!seconds || seconds <= 0 || !isFinite(seconds)) return '未知';
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

        // 同时删除对应的 HLS 缓存
        const safeFilename = fileName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5._-]/g, '_');
        const hlsCachePath = path.join(hlsCacheDir, safeFilename);
        if (fs.existsSync(hlsCachePath)) {
            try {
                fs.rmSync(hlsCachePath, { recursive: true, force: true });
                console.log(`已删除 HLS 缓存: ${safeFilename}`);
            } catch (e) {
                console.error(`删除 HLS 缓存失败: ${safeFilename}`, e);
            }
        }

        // 删除元数据缓存
        removeFromMetadataCache(fileName);

        // 删除封面缓存
        removeCoverCache(fileName);

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
