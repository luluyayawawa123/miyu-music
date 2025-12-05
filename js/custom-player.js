// 自定义音频播放器控制器
document.addEventListener('DOMContentLoaded', () => {
    const audioPlayer = document.getElementById('audio-player');

    // UI 元素
    const playBtn = document.getElementById('play-btn');
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const volumeBtn = document.getElementById('volume-btn');

    const progressTrack = document.getElementById('progress-track');
    const progressFill = document.getElementById('progress-fill');
    const progressThumb = document.getElementById('progress-thumb');
    const progressBuffer = document.getElementById('progress-buffer');
    const timeCurrent = document.querySelector('.time-current');
    const timeTotal = document.querySelector('.time-total');

    const volumeTrack = document.getElementById('volume-track');
    const volumeFill = document.getElementById('volume-fill');

    let isDraggingProgress = false;
    let isDraggingVolume = false;
    let lastVolume = 1;

    // === 工具函数 ===
    function formatTime(seconds) {
        if (isNaN(seconds) || seconds === Infinity) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    // === 播放控制 ===
    function updatePlayButton() {
        const icon = playBtn.querySelector('i');
        if (audioPlayer.paused) {
            icon.className = 'bi bi-play-fill';
            playBtn.title = '播放';
        } else {
            icon.className = 'bi bi-pause-fill';
            playBtn.title = '暂停';
        }
    }

    playBtn.addEventListener('click', () => {
        if (audioPlayer.paused) {
            audioPlayer.play().catch(e => console.error('播放失败:', e));
        } else {
            audioPlayer.pause();
        }
    });

    audioPlayer.addEventListener('play', updatePlayButton);
    audioPlayer.addEventListener('pause', updatePlayButton);

    // === 上一曲/下一曲 ===
    prevBtn.addEventListener('click', () => {
        // 调用 app.js 中的 playPrevious 函数
        if (typeof playPrevious === 'function') {
            playPrevious();
        } else {
            // 回退：触发自定义事件
            window.dispatchEvent(new CustomEvent('player:prev'));
        }
    });

    nextBtn.addEventListener('click', () => {
        // 调用 app.js 中的 playNext 函数
        if (typeof playNext === 'function') {
            playNext();
        } else {
            // 回退：触发自定义事件
            window.dispatchEvent(new CustomEvent('player:next'));
        }
    });

    // === 进度条控制 ===
    function updateProgress() {
        if (isDraggingProgress) return;

        const duration = audioPlayer.duration || 0;
        const currentTime = audioPlayer.currentTime || 0;
        const percent = duration > 0 ? (currentTime / duration) * 100 : 0;

        progressFill.style.width = percent + '%';
        progressThumb.style.left = percent + '%';
        timeCurrent.textContent = formatTime(currentTime);
    }

    function seekTo(e) {
        const rect = progressTrack.getBoundingClientRect();
        const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const duration = audioPlayer.duration || 0;

        audioPlayer.currentTime = percent * duration;
        progressFill.style.width = (percent * 100) + '%';
        progressThumb.style.left = (percent * 100) + '%';
    }

    progressTrack.addEventListener('mousedown', (e) => {
        isDraggingProgress = true;
        progressThumb.classList.add('dragging');
        seekTo(e);
    });

    document.addEventListener('mousemove', (e) => {
        if (isDraggingProgress) {
            seekTo(e);
        }
        if (isDraggingVolume) {
            setVolume(e);
        }
    });

    document.addEventListener('mouseup', () => {
        if (isDraggingProgress) {
            isDraggingProgress = false;
            progressThumb.classList.remove('dragging');
        }
        if (isDraggingVolume) {
            isDraggingVolume = false;
        }
    });

    audioPlayer.addEventListener('timeupdate', updateProgress);

    audioPlayer.addEventListener('loadedmetadata', () => {
        timeTotal.textContent = formatTime(audioPlayer.duration);
        updateProgress();
    });

    audioPlayer.addEventListener('durationchange', () => {
        timeTotal.textContent = formatTime(audioPlayer.duration);
    });

    // === 音量控制 ===
    function updateVolumeUI() {
        const volume = audioPlayer.volume;
        const percent = volume * 100;
        volumeFill.style.width = percent + '%';

        const icon = volumeBtn.querySelector('i');
        if (audioPlayer.muted || volume === 0) {
            icon.className = 'bi bi-volume-mute-fill';
        } else if (volume < 0.5) {
            icon.className = 'bi bi-volume-down-fill';
        } else {
            icon.className = 'bi bi-volume-up-fill';
        }
    }

    function setVolume(e) {
        const rect = volumeTrack.getBoundingClientRect();
        const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));

        audioPlayer.volume = percent;
        audioPlayer.muted = false;
        lastVolume = percent;
        updateVolumeUI();
    }

    volumeTrack.addEventListener('mousedown', (e) => {
        isDraggingVolume = true;
        setVolume(e);
    });

    volumeBtn.addEventListener('click', () => {
        if (audioPlayer.muted || audioPlayer.volume === 0) {
            audioPlayer.muted = false;
            audioPlayer.volume = lastVolume || 0.5;
        } else {
            lastVolume = audioPlayer.volume;
            audioPlayer.muted = true;
        }
        updateVolumeUI();
    });


    // === 缓冲进度更新 ===
    function updateBuffer() {
        if (audioPlayer.buffered.length > 0) {
            const duration = audioPlayer.duration || 0;
            if (duration > 0) {
                // 获取最后一个缓冲区间的结束位置
                const bufferedEnd = audioPlayer.buffered.end(audioPlayer.buffered.length - 1);
                const bufferPercent = (bufferedEnd / duration) * 100;
                progressBuffer.style.width = bufferPercent + '%';
            }
        }
    }

    audioPlayer.addEventListener('progress', updateBuffer);
    audioPlayer.addEventListener('loadedmetadata', updateBuffer);
    // 初始化音量UI
    updateVolumeUI();

    // === 触摸支持 ===
    progressTrack.addEventListener('touchstart', (e) => {
        isDraggingProgress = true;
        progressThumb.classList.add('dragging');
        const touch = e.touches[0];
        seekTo({ clientX: touch.clientX });
    });

    progressTrack.addEventListener('touchmove', (e) => {
        if (isDraggingProgress) {
            const touch = e.touches[0];
            seekTo({ clientX: touch.clientX });
        }
    });

    progressTrack.addEventListener('touchend', () => {
        isDraggingProgress = false;
        progressThumb.classList.remove('dragging');
    });

    volumeTrack.addEventListener('touchstart', (e) => {
        isDraggingVolume = true;
        const touch = e.touches[0];
        setVolume({ clientX: touch.clientX });
    });

    volumeTrack.addEventListener('touchmove', (e) => {
        if (isDraggingVolume) {
            const touch = e.touches[0];
            setVolume({ clientX: touch.clientX });
        }
    });

    volumeTrack.addEventListener('touchend', () => {
        isDraggingVolume = false;
    });
});

