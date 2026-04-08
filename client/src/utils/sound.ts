// Sound notification utility using Web Audio API
let audioContext: AudioContext | null = null;

export const initializeSound = () => {
    try {
        const AudioCtx = window.AudioContext
            ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AudioCtx) {
            audioContext = new AudioCtx();
        }
    } catch {
        // Audio not supported in this environment
    }
};

export const playNotificationSound = () => {
    try {
        if (audioContext) {
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            oscillator.frequency.value = 800;
            oscillator.type = 'sine';

            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);

            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.5);
        }
    } catch {
        // Silently fail — sound is non-critical
    }
};

export const testSound = () => {
    playNotificationSound();
};
