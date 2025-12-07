document.addEventListener('DOMContentLoaded', () => {
    const audioPlayer = document.getElementById('audio-player');
    const musicFileInput = document.getElementById('music-file-input');
    const playlistItemsContainer = document.getElementById('playlist-items');
    const nowPlayingTitle = document.querySelector('.now-playing-title');
    const defaultAlbumIcon = document.querySelector('.default-album-icon');
    const shuffleBtn = document.getElementById('shuffle-btn');
    const repeatBtn = document.getElementById('repeat-btn');

    let audioContext;
    const playlist = []; // To store {name: string, url: string}

    // 播放模式
    let playMode = {
        shuffle: false,    // 随机播放
        repeat: 'none'     // 'none' 不循环, 'all' 列表循环, 'one' 单曲循环
    };

    // 密码验证函数
    async function verifyPassword(action) {
        // 创建对话框
        const dialogOverlay = document.createElement('div');
        dialogOverlay.className = 'password-dialog-overlay';

        const dialog = document.createElement('div');
        dialog.className = 'password-dialog';

        let headerText = '需要密码验证';
        if (action === 'upload') {
            headerText = '上传音乐需要密码验证';
        } else if (action === 'delete') {
            headerText = '删除音乐需要密码验证';
        }

        dialog.innerHTML = `
            <h3>${headerText}</h3>
            <p>请输入系统密码以继续操作</p>
            <input type="password" id="password-input" placeholder="输入密码" />
            <div class="dialog-buttons">
                <button id="cancel-btn">取消</button>
                <button id="confirm-btn">确认</button>
            </div>
        `;

        dialogOverlay.appendChild(dialog);
        document.body.appendChild(dialogOverlay);

        const passwordInput = document.getElementById('password-input');
        const cancelBtn = document.getElementById('cancel-btn');
        const confirmBtn = document.getElementById('confirm-btn');

        // 聚焦到密码输入框
        passwordInput.focus();

        return new Promise((resolve, reject) => {
            // 取消按钮
            cancelBtn.addEventListener('click', () => {
                document.body.removeChild(dialogOverlay);
                resolve(false);
            });

            // 确认按钮
            confirmBtn.addEventListener('click', async () => {
                const password = passwordInput.value;

                if (!password.trim()) {
                    alert('请输入密码');
                    return;
                }

                try {
                    const response = await fetch('/api/verify-password', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ password })
                    });

                    const result = await response.json();

                    if (result.verified) {
                        document.body.removeChild(dialogOverlay);
                        resolve(password); // 返回验证通过的密码
                    } else {
                        alert('密码错误，请重试');
                        passwordInput.value = '';
                        passwordInput.focus();
                    }
                } catch (error) {
                    console.error('验证密码错误:', error);
                    alert('验证过程中发生错误，请重试');
                    reject(error);
                }
            });

            // 回车键提交
            passwordInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    confirmBtn.click();
                }
            });
        });
    }

    // --- Load initial playlist from server ---
    async function loadPlaylistFromServer() {
        try {
            const response = await fetch('/api/music');
            if (!response.ok) {
                throw new Error(`获取音乐列表失败: ${response.statusText}`);
            }
            const serverPlaylist = await response.json();
            playlist.length = 0; // Clear local playlist
            serverPlaylist.forEach(track => playlist.push(track));
            renderPlaylist();
            if (playlist.length > 0 && !audioPlayer.src) {
                // Auto-play first track is commented out to avoid autoplay restrictions
                // playTrack(0);
            }
        } catch (error) {
            console.error("Error loading playlist from server:", error);
            alert("无法从服务器加载音乐列表。请确保后端服务已启动。");
        }
    }

    // 创建上传进度条UI
    function createProgressBar() {
        const progressOverlay = document.createElement('div');
        progressOverlay.className = 'progress-overlay';

        const progressContainer = document.createElement('div');
        progressContainer.className = 'progress-container';

        progressContainer.innerHTML = `
            <h3>上传进度</h3>
            <div class="progress-bar-container">
                <div class="progress-bar" id="upload-progress-bar"></div>
            </div>
            <div class="progress-status" id="progress-status">准备上传...</div>
        `;

        progressOverlay.appendChild(progressContainer);
        document.body.appendChild(progressOverlay);

        return {
            update: (percent, status) => {
                document.getElementById('upload-progress-bar').style.width = `${percent}%`;
                if (status) {
                    document.getElementById('progress-status').textContent = status;
                }
            },
            close: () => {
                document.body.removeChild(progressOverlay);
            }
        };
    }

    // Handle music file uploads
    musicFileInput.addEventListener('change', async (event) => {
        const files = event.target.files;
        if (files.length > 0) {
            // 要求密码验证
            const password = await verifyPassword('upload');
            if (!password) {
                musicFileInput.value = ''; // 重置文件输入
                return;
            }

            const formData = new FormData();
            let validFilesFound = false;
            for (const file of files) {
                if (file.type.startsWith('audio/')) {
                    formData.append('musicFiles', file); // Use 'musicFiles' to match server
                    validFilesFound = true;
                } else {
                    alert(`文件 ${file.name} 不是支持的音频格式，将被忽略。`);
                }
            }

            if (!validFilesFound) {
                alert("没有选择有效的音频文件。");
                musicFileInput.value = ''; // Reset file input
                return;
            }

            try {
                // 添加密码到表单数据
                formData.append('password', password);

                // 创建进度条
                const progressBar = createProgressBar();

                // 使用 XMLHttpRequest 而不是 fetch 来跟踪上传进度
                const xhr = new XMLHttpRequest();

                xhr.upload.addEventListener('progress', (event) => {
                    if (event.lengthComputable) {
                        const percent = Math.round((event.loaded / event.total) * 100);
                        progressBar.update(percent, `上传中 ${percent}%`);
                    }
                });

                xhr.addEventListener('load', async () => {
                    progressBar.update(100, '处理中...');

                    if (xhr.status >= 200 && xhr.status < 300) {
                        setTimeout(() => {
                            progressBar.close();
                            const result = JSON.parse(xhr.responseText);
                            alert(result.message || `${files.length} 个文件处理完毕。`);
                            loadPlaylistFromServer();
                        }, 500);
                    } else {
                        progressBar.close();
                        let errorMessage = '上传失败';
                        try {
                            const response = JSON.parse(xhr.responseText);
                            errorMessage = response.error || errorMessage;
                        } catch (e) { }
                        alert(errorMessage);
                    }
                });

                xhr.addEventListener('error', () => {
                    progressBar.close();
                    alert('上传过程中发生错误');
                });

                xhr.addEventListener('abort', () => {
                    progressBar.close();
                    alert('上传已取消');
                });

                xhr.open('POST', '/api/upload');
                xhr.send(formData);
            } catch (error) {
                console.error("Error uploading files:", error);
                alert(`上传文件时发生错误: ${error.message}`);
            }
            musicFileInput.value = ''; // Reset file input
        }
    });

    // 删除音乐文件
    async function deleteTrack(fileName) {
        try {
            // 要求密码验证
            const password = await verifyPassword('delete');
            if (!password) return false;

            // 发送删除请求
            const response = await fetch(`/api/music/${encodeURIComponent(fileName)}`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ password })
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || '删除文件失败');
            }

            alert(result.message || `文件已成功删除`);
            await loadPlaylistFromServer(); // 刷新播放列表
            return true;
        } catch (error) {
            console.error("删除文件错误:", error);
            alert(`删除文件时发生错误: ${error.message}`);
            return false;
        }
    }

    // === 拖拽排序相关变量 ===
    let draggedItemIndex = null;

    function renderPlaylist() {
        playlistItemsContainer.innerHTML = ''; // Clear existing items
        playlist.forEach((track, index) => {
            const listItem = document.createElement('li');
            listItem.dataset.index = index;

            // 添加拖拽属性
            listItem.setAttribute('draggable', 'true');

            // 添加拖拽事件监听
            listItem.addEventListener('dragstart', handleDragStart);
            listItem.addEventListener('dragenter', handleDragEnter);
            listItem.addEventListener('dragover', handleDragOver);
            listItem.addEventListener('dragleave', handleDragLeave);
            listItem.addEventListener('drop', handleDrop);
            listItem.addEventListener('dragend', handleDragEnd);

            // Create a container for track name and download button for better layout
            const trackInfoContainer = document.createElement('div');
            trackInfoContainer.className = 'track-info';

            // Create thumbnail container for small album art
            const thumbnailContainer = document.createElement('div');
            thumbnailContainer.className = 'track-thumbnail';

            if (track.hasCover) {
                // Add small thumbnail image if track has a cover
                const thumbnail = document.createElement('img');
                thumbnail.src = `/api/cover/${encodeURIComponent(track.coverId)}?size=small`;
                thumbnail.className = 'track-thumbnail-img';
                thumbnailContainer.appendChild(thumbnail);
            } else {
                // Add default music icon if no cover
                const defaultIcon = document.createElement('i');
                defaultIcon.className = 'bi bi-music-note';
                thumbnailContainer.appendChild(defaultIcon);
            }

            // Create track details container
            const trackDetailsContainer = document.createElement('div');
            trackDetailsContainer.className = 'track-details';

            // Display track title if available, otherwise use filename
            const trackNameSpan = document.createElement('span');
            trackNameSpan.className = 'track-name';
            trackNameSpan.textContent = track.title || track.name;

            // Create artist span if artist info is available
            const artistSpan = document.createElement('span');
            artistSpan.className = 'track-artist';
            artistSpan.textContent = track.artist || '';

            // Create download button/link
            const downloadLink = document.createElement('a');
            downloadLink.href = track.url; // URL from server (e.g., /music/song.mp3)
            downloadLink.innerHTML = '<i class="bi bi-cloud-download"></i>';
            downloadLink.setAttribute('title', '下载 ' + track.name);
            downloadLink.setAttribute('download', track.name); // Suggests filename to browser
            downloadLink.className = 'download-button'; // For styling
            // Prevent click on download button from also triggering playTrack
            downloadLink.addEventListener('click', (event) => {
                event.stopPropagation();
            });

            // 创建信息按钮
            const infoButton = document.createElement('button');
            infoButton.innerHTML = '<i class="bi bi-info-circle"></i>';
            infoButton.className = 'info-button';
            infoButton.setAttribute('title', '查看音频信息');
            infoButton.addEventListener('click', (event) => {
                event.stopPropagation(); // 防止触发播放
                showAudioInfo(track.name);
            });

            // 创建删除按钮
            const deleteButton = document.createElement('button');
            deleteButton.innerHTML = '<i class="bi bi-trash"></i>';
            deleteButton.className = 'delete-button';
            deleteButton.setAttribute('title', '删除 ' + track.name);
            deleteButton.addEventListener('click', (event) => {
                event.stopPropagation(); // 防止触发播放

                // 确认是否删除
                if (confirm(`确定要删除 "${track.title || track.name}" 吗？`)) {
                    deleteTrack(track.name);
                }
            });

            // Assemble all components
            trackDetailsContainer.appendChild(trackNameSpan);
            if (track.artist) trackDetailsContainer.appendChild(artistSpan);

            trackInfoContainer.appendChild(thumbnailContainer);
            trackInfoContainer.appendChild(trackDetailsContainer);
            trackInfoContainer.appendChild(downloadLink);
            trackInfoContainer.appendChild(infoButton);
            trackInfoContainer.appendChild(deleteButton);
            listItem.appendChild(trackInfoContainer);

            listItem.addEventListener('click', () => {
                playTrack(index);
            });
            playlistItemsContainer.appendChild(listItem);
        });

        // 恢复当前播放高亮
        highlightCurrentTrack();
    }

    // === 拖拽事件处理函数 ===
    function handleDragStart(e) {
        this.classList.add('dragging');
        draggedItemIndex = parseInt(this.dataset.index);
        e.dataTransfer.effectAllowed = 'move';
        // 设置拖拽数据，虽然我们在内部使用变量，但为了兼容性还是设置一下
        e.dataTransfer.setData('text/plain', draggedItemIndex);
    }

    function handleDragEnter(e) {
        e.preventDefault();
        if (this.dataset.index != draggedItemIndex) {
            this.classList.add('drag-over');
        }
    }

    function handleDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        return false;
    }

    function handleDragLeave(e) {
        this.classList.remove('drag-over');
    }

    function handleDrop(e) {
        e.stopPropagation(); // 停止冒泡
        e.preventDefault();

        // 移除视觉反馈
        this.classList.remove('drag-over');

        const targetIndex = parseInt(this.dataset.index);

        if (draggedItemIndex !== null && draggedItemIndex !== targetIndex) {
            reorderPlaylist(draggedItemIndex, targetIndex);
        }

        return false;
    }

    function handleDragEnd(e) {
        this.classList.remove('dragging');
        // 清理所有可能的 drag-over 类
        document.querySelectorAll('#playlist-items li').forEach(item => {
            item.classList.remove('drag-over');
        });
        draggedItemIndex = null;
    }

    // 重新排序播放列表
    function reorderPlaylist(fromIndex, toIndex) {
        // 获取当前播放的歌曲信息，以便重新定位
        const currentTrackIndex = getCurrentTrackIndex();
        const currentTrack = currentTrackIndex !== -1 ? playlist[currentTrackIndex] : null;

        // 移动数组元素
        const itemToMove = playlist[fromIndex];
        playlist.splice(fromIndex, 1);
        playlist.splice(toIndex, 0, itemToMove);

        // 重新渲染列表
        renderPlaylist();

        // 如果正在播放，更新当前播放索引并保持高亮
        if (currentTrack) {
            // 找到当前播放歌曲的新索引
            const newCurrentIndex = playlist.findIndex(t => t === currentTrack);
            // 更新UI高亮，不需要重新加载音频
            highlightCurrentTrack(newCurrentIndex);
        }

        // === 保存新顺序到服务器 ===
        savePlaylistOrder();
    }

    // 保存播放列表顺序到服务器
    async function savePlaylistOrder() {
        try {
            // 提取文件名列表
            const order = playlist.map(track => track.name);

            await fetch('/api/playlist/order', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ order })
            });
        } catch (error) {
            console.error("Failed to save playlist order:", error);
        }
    }

    // 高亮当前播放曲目
    function highlightCurrentTrack(forceIndex = -1) {
        const index = forceIndex !== -1 ? forceIndex : getCurrentTrackIndex();

        document.querySelectorAll('#playlist-items li').forEach((li, i) => {
            if (i === index) {
                li.classList.add('active');
            } else {
                li.classList.remove('active');
            }
        });
    }

    // 显示/隐藏加载提示
    function showLoadingState(show, message = '加载中...') {
        let loadingOverlay = document.querySelector('.audio-loading-overlay');

        if (show) {
            if (!loadingOverlay) {
                loadingOverlay = document.createElement('div');
                loadingOverlay.className = 'audio-loading-overlay';
                loadingOverlay.innerHTML = `
                    <div class="loading-spinner"></div>
                    <span class="loading-text">${message}</span>
                `;
                document.querySelector('.player-card').appendChild(loadingOverlay);
            } else {
                loadingOverlay.querySelector('.loading-text').textContent = message;
                loadingOverlay.style.display = 'flex';
            }
        } else {
            if (loadingOverlay) {
                loadingOverlay.style.display = 'none';
            }
        }
    }

    // === iOS/移动端检测 ===
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    // 当前 HLS 实例（用于清理）
    let currentHls = null;

    // 判断是否需要使用 HLS 播放
    function shouldUseHLS(filename) {
        const ext = filename.split('.').pop().toLowerCase();
        // 只有 iOS 上的非 MP3 格式才使用 HLS
        // MP3 和 OGG 在 iOS 上已经支持流式播放
        const hlsFormats = ['m4a', 'wav', 'aac', 'flac'];
        return isIOS && hlsFormats.includes(ext);
    }

    // HLS 播放函数（带轮询等待转码完成）
    async function playHLSTrack(track, index) {
        showLoadingState(true, '正在准备...');

        // 清理之前的 HLS 实例
        if (currentHls) {
            currentHls.destroy();
            currentHls = null;
        }

        const hlsUrl = `/hls/${encodeURIComponent(track.name)}`;
        const statusUrl = `/hls-status/${encodeURIComponent(track.name)}`;

        // Update UI immediately
        updateNowPlaying(track);
        document.querySelectorAll('#playlist-items li').forEach((li, i) => {
            li.classList.toggle('active', i === index);
        });

        try {
            // 首先请求 HLS，触发转码开始
            const response = await fetch(hlsUrl);

            if (response.status === 202) {
                // 需要等待转码完成，开始轮询
                console.log('HLS 转码中，开始轮询...');
                showLoadingState(true, '正在转码...');

                const success = await waitForTranscoding(track.name, statusUrl);
                if (!success) {
                    showLoadingState(true, '转码失败，请重试');
                    setTimeout(() => showLoadingState(false), 2000);
                    return;
                }
            } else if (!response.ok) {
                throw new Error('HLS 请求失败');
            }

            // 转码完成，开始播放
            playHLSStream(hlsUrl, track, index);

        } catch (error) {
            console.error('HLS 播放错误:', error);
            showLoadingState(true, '加载失败，请重试');
            setTimeout(() => showLoadingState(false), 2000);
        }
    }

    // 轮询等待转码完成
    async function waitForTranscoding(filename, statusUrl) {
        const maxWaitTime = 5 * 60 * 1000; // 最多等待5分钟
        const pollInterval = 2000; // 每2秒轮询一次
        const startTime = Date.now();

        while (Date.now() - startTime < maxWaitTime) {
            try {
                const response = await fetch(statusUrl);
                const status = await response.json();

                console.log('转码状态:', status);

                if (status.status === 'done') {
                    showLoadingState(true, '转码完成，正在加载...');
                    return true;
                } else if (status.status === 'error') {
                    console.error('转码错误:', status.error);
                    return false;
                } else {
                    // 还在转码中，更新进度显示
                    const progress = status.progress || 0;
                    showLoadingState(true, `转码中 ${progress}%...`);
                }

                // 等待后继续轮询
                await new Promise(resolve => setTimeout(resolve, pollInterval));

            } catch (error) {
                console.error('轮询状态失败:', error);
                // 继续尝试
                await new Promise(resolve => setTimeout(resolve, pollInterval));
            }
        }

        console.error('转码超时');
        return false;
    }

    // 播放 HLS 流
    function playHLSStream(hlsUrl, track, index) {
        showLoadingState(true, '正在加载...');

        // iOS Safari 原生支持 HLS
        if (audioPlayer.canPlayType('application/vnd.apple.mpegurl')) {
            console.log('使用 iOS 原生 HLS 播放:', track.name);

            const onCanPlay = () => {
                showLoadingState(false);
                // 确保从头开始播放
                audioPlayer.currentTime = 0;
                audioPlayer.play().catch(e => {
                    console.error("HLS 播放失败:", e);
                    showLoadingState(false);
                });
                audioPlayer.removeEventListener('canplay', onCanPlay);
                audioPlayer.removeEventListener('error', onError);
            };

            const onError = (e) => {
                console.error("HLS 加载失败:", e);
                showLoadingState(true, '播放失败，请重试');
                setTimeout(() => showLoadingState(false), 2000);
                audioPlayer.removeEventListener('canplay', onCanPlay);
                audioPlayer.removeEventListener('error', onError);
            };

            audioPlayer.addEventListener('canplay', onCanPlay);
            audioPlayer.addEventListener('error', onError);

            audioPlayer.src = hlsUrl;
            audioPlayer.load();

        } else if (typeof Hls !== 'undefined' && Hls.isSupported()) {
            // 使用 HLS.js (其他浏览器)
            console.log('使用 HLS.js 播放:', track.name);

            currentHls = new Hls({
                enableWorker: true,
                lowLatencyMode: false
            });

            currentHls.loadSource(hlsUrl);
            currentHls.attachMedia(audioPlayer);

            currentHls.on(Hls.Events.MANIFEST_PARSED, () => {
                showLoadingState(false);
                // 确保从头开始播放
                audioPlayer.currentTime = 0;
                audioPlayer.play().catch(e => console.error("HLS.js 播放失败:", e));
            });

            currentHls.on(Hls.Events.ERROR, (event, data) => {
                console.error("HLS.js 错误:", data);
                if (data.fatal) {
                    showLoadingState(true, 'HLS 加载失败');
                    setTimeout(() => showLoadingState(false), 2000);
                }
            });
        } else {
            // 不支持 HLS，回退到普通播放
            console.log('HLS 不支持，使用普通播放');
            playTrackNormal(track, index);
            return;
        }

        // Initialize Web Audio API if not already done
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
    }

    // 普通播放函数（原 playTrack 逻辑）
    function playTrackNormal(track, index) {
        // 清理之前的 HLS 实例
        if (currentHls) {
            currentHls.destroy();
            currentHls = null;
        }

        // 显示加载状态
        showLoadingState(true, '正在加载...');

        // 移除之前的事件监听器（避免重复绑定）
        const onCanPlay = () => {
            showLoadingState(false);
            audioPlayer.play().catch(e => {
                console.error("Error playing audio:", e);
                showLoadingState(false);
            });
            audioPlayer.removeEventListener('canplay', onCanPlay);
            audioPlayer.removeEventListener('error', onError);
            clearTimeout(loadingTimeout);
        };

        const onError = (e) => {
            console.error("Error loading audio:", e);
            showLoadingState(true, '加载失败，请重试');
            setTimeout(() => showLoadingState(false), 2000);
            audioPlayer.removeEventListener('canplay', onCanPlay);
            audioPlayer.removeEventListener('error', onError);
            clearTimeout(loadingTimeout);
        };

        // 超时处理：5秒后如果还没加载好，给用户提示
        const loadingTimeout = setTimeout(() => {
            showLoadingState(true, '网络较慢，请耐心等待...');
        }, 5000);

        // 绑定事件
        audioPlayer.addEventListener('canplay', onCanPlay);
        audioPlayer.addEventListener('error', onError);

        // 设置音频源
        audioPlayer.src = track.url;
        audioPlayer.load(); // 显式加载

        // Update now playing information
        updateNowPlaying(track);

        // Update active item in playlist
        document.querySelectorAll('#playlist-items li').forEach((li, i) => {
            if (i === index) {
                li.classList.add('active');
            } else {
                li.classList.remove('active');
            }
        });

        // Initialize Web Audio API if not already done
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
    }

    function playTrack(index) {
        if (index < 0 || index >= playlist.length) return;

        const track = playlist[index];

        // 检测是否需要使用 HLS (iOS 上的 M4A/WAV 等格式)
        if (shouldUseHLS(track.name)) {
            console.log('iOS 检测到，使用 HLS 播放:', track.name);
            playHLSTrack(track, index);
            return;
        }

        // 使用普通播放
        playTrackNormal(track, index);
    }

    // Update the now playing information
    function updateNowPlaying(track) {
        // Update track title
        nowPlayingTitle.textContent = track.title || track.name;

        // Handle album art
        const albumArt = document.querySelector('.album-art');

        if (track.hasCover) {
            // Hide default icon
            defaultAlbumIcon.style.display = 'none';

            // Create or get the album art image
            let albumImg = document.querySelector('.album-art img');
            if (!albumImg) {
                albumImg = document.createElement('img');
                albumImg.className = 'album-cover';
                albumArt.appendChild(albumImg);
            }

            // Set the image source with cache-busting query parameter
            albumImg.src = `/api/cover/${encodeURIComponent(track.coverId)}?t=${Date.now()}`;
            albumImg.style.display = 'block';
        } else {
            // If no cover, show default icon
            defaultAlbumIcon.style.display = 'block';

            // Hide album image if it exists
            const albumImg = document.querySelector('.album-art img');
            if (albumImg) {
                albumImg.style.display = 'none';
            }
        }
    }

    // 获取当前播放的曲目索引
    function getCurrentTrackIndex() {
        // 尝试从播放列表的活动项获取
        const activeItem = document.querySelector('#playlist-items li.active');
        if (activeItem) {
            return parseInt(activeItem.dataset.index);
        }

        // 如果没有活动项，尝试从URL匹配
        if (audioPlayer.src) {
            const currentTrackUrl = audioPlayer.src;
            return playlist.findIndex(track =>
                currentTrackUrl.includes(encodeURIComponent(track.name))
            );
        }

        return -1; // 没有找到当前播放的曲目
    }

    // 播放下一曲
    function playNext() {
        if (playlist.length === 0) return;

        const currentIndex = getCurrentTrackIndex();
        let nextIndex;

        if (playMode.shuffle) {
            // 随机模式：选择一个随机的不同索引
            if (playlist.length === 1) {
                nextIndex = 0;
            } else {
                do {
                    nextIndex = Math.floor(Math.random() * playlist.length);
                } while (nextIndex === currentIndex && playlist.length > 1);
            }
        } else {
            // 顺序模式：选择下一个索引或回到开始
            nextIndex = (currentIndex + 1) % playlist.length;
        }

        playTrack(nextIndex);
    }

    // 播放上一曲
    function playPrevious() {
        if (playlist.length === 0) return;

        const currentIndex = getCurrentTrackIndex();
        let prevIndex;

        if (playMode.shuffle) {
            // 随机模式：选择一个随机的不同索引
            if (playlist.length === 1) {
                prevIndex = 0;
            } else {
                do {
                    prevIndex = Math.floor(Math.random() * playlist.length);
                } while (prevIndex === currentIndex && playlist.length > 1);
            }
        } else {
            // 顺序模式：选择上一个索引或跳到末尾
            prevIndex = (currentIndex - 1 + playlist.length) % playlist.length;
        }

        playTrack(prevIndex);
    }

    // 设置播放模式
    function updatePlayModeUI() {
        // 随机播放按钮状态
        if (playMode.shuffle) {
            shuffleBtn.classList.add('active');
            shuffleBtn.title = "关闭随机播放";
        } else {
            shuffleBtn.classList.remove('active');
            shuffleBtn.title = "随机播放";
        }

        // 循环按钮状态和图标
        switch (playMode.repeat) {
            case 'none':
                repeatBtn.classList.remove('active');
                repeatBtn.innerHTML = '<i class="bi bi-arrow-repeat"></i>';
                repeatBtn.title = "列表循环";
                break;
            case 'all':
                repeatBtn.classList.add('active');
                repeatBtn.innerHTML = '<i class="bi bi-arrow-repeat"></i>';
                repeatBtn.title = "单曲循环";
                break;
            case 'one':
                repeatBtn.classList.add('active');
                repeatBtn.innerHTML = '<i class="bi bi-repeat-1"></i>';
                repeatBtn.title = "取消循环";
                break;
        }
    }

    // 随机播放按钮点击事件
    shuffleBtn.addEventListener('click', () => {
        playMode.shuffle = !playMode.shuffle;
        updatePlayModeUI();
    });

    // 循环按钮点击事件
    repeatBtn.addEventListener('click', () => {
        // 切换循环模式: none -> all -> one -> none
        switch (playMode.repeat) {
            case 'none':
                playMode.repeat = 'all';
                break;
            case 'all':
                playMode.repeat = 'one';
                break;
            case 'one':
                playMode.repeat = 'none';
                break;
        }
        updatePlayModeUI();
    });

    // 音频播放结束事件处理
    audioPlayer.addEventListener('ended', () => {
        // 根据不同的播放模式处理
        switch (playMode.repeat) {
            case 'one':
                // 单曲循环：重新播放当前曲目
                audioPlayer.currentTime = 0;
                audioPlayer.play().catch(e => console.error("Error replaying audio:", e));
                break;

            case 'all':
                // 列表循环：播放下一曲 (playNext 会处理循环回开始)
                playNext();
                break;

            case 'none':
                // 不循环：如果是最后一首就停止，否则播放下一首
                const currentIndex = getCurrentTrackIndex();
                if (currentIndex < playlist.length - 1 || playMode.shuffle) {
                    playNext();
                }
                break;
        }
    });

    // Audio player event listeners for state changes
    audioPlayer.addEventListener('play', () => {
        if (nowPlayingTitle.textContent === '选择一首歌曲开始播放' && audioPlayer.src) {
            // Try to figure out what's playing based on the URL
            const url = new URL(audioPlayer.src);
            const path = decodeURIComponent(url.pathname);
            const filename = path.split('/').pop();
            if (filename) {
                updateNowPlaying(filename);
            }
        }
    });

    // Initial load from server
    loadPlaylistFromServer();
    // 初始化UI
    updatePlayModeUI();

    // 暴露全局函数供自定义播放器使用
    window.playNext = playNext;
    window.playPrevious = playPrevious;
});


