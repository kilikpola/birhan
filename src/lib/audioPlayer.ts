import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { getLocalDb, runTransactionExclusive } from '@/utils/db';
import { reportError } from '@/lib/errors';

export interface AudioPlayerState {
  isLoaded: boolean;
  isPlaying: boolean;
  position: number;
  duration: number;
  currentBook: number | null;
  currentChapter: number | null;
  playbackRate: number;
  volume: number;
  error: string | null;
}

type StateListener = (state: AudioPlayerState) => void;

let sound: Audio.Sound | null = null;
let state: AudioPlayerState = {
  isLoaded: false,
  isPlaying: false,
  position: 0,
  duration: 0,
  currentBook: null,
  currentChapter: null,
  playbackRate: 1.0,
  volume: 1.0,
  error: null,
};
const listeners = new Set<StateListener>();
let positionUpdateInterval: ReturnType<typeof setInterval> | null = null;

function emitState(): void {
  const snapshot = { ...state };
  listeners.forEach(listener => listener(snapshot));
}

function setState(partial: Partial<AudioPlayerState>): void {
  state = { ...state, ...partial };
  emitState();
}

async function configureAudioMode(): Promise<void> {
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: false,
    staysActiveInBackground: true,
    interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
    interruptionModeIOS: InterruptionModeIOS.DuckOthers,
    playThroughEarpieceAndroid: false,
    shouldDuckAndroid: true,
  });
}

export async function initAudioPlayer(): Promise<void> {
  await configureAudioMode();
  
  const localDb = await getLocalDb();
  const savedRate = await localDb.getFirstAsync<{ value: string }>(
    'SELECT value FROM settings WHERE key = ?', ['audio_playback_rate']
  );
  if (savedRate) {
    state.playbackRate = parseFloat(savedRate.value);
  }
  
  const savedVolume = await localDb.getFirstAsync<{ value: string }>(
    'SELECT value FROM settings WHERE key = ?', ['audio_volume']
  );
  if (savedVolume) {
    state.volume = parseFloat(savedVolume.value);
  }
}

export function subscribe(listener: StateListener): () => void {
  listeners.add(listener);
  listener({ ...state });
  return () => listeners.delete(listener);
}

export function getState(): AudioPlayerState {
  return { ...state };
}

export async function loadChapter(bookId: number, chapter: number, localPath: string): Promise<void> {
  await unload();
  
  try {
    const { sound: newSound } = await Audio.Sound.createAsync(
      { uri: localPath },
      { shouldPlay: false, rate: state.playbackRate, volume: state.volume },
      onPlaybackStatusUpdate
    );
    
    sound = newSound;
    setState({
      isLoaded: true,
      isPlaying: false,
      position: 0,
      duration: newSound.getStatus().durationMillis || 0,
      currentBook: bookId,
      currentChapter: chapter,
      error: null,
    });
    
    startPositionUpdates();
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Failed to load audio';
    setState({ error, isLoaded: false });
    reportError(err instanceof Error ? err : new Error(error), 'audioPlayer.loadChapter');
    throw err;
  }
}

export async function play(): Promise<void> {
  if (!sound || !state.isLoaded) return;
  
  try {
    await sound.playAsync();
    setState({ isPlaying: true });
  } catch (err) {
    setState({ error: err instanceof Error ? err.message : 'Playback failed' });
    reportError(err instanceof Error ? err : new Error('Playback failed'), 'audioPlayer.play');
  }
}

export async function pause(): Promise<void> {
  if (!sound) return;
  
  try {
    await sound.pauseAsync();
    setState({ isPlaying: false });
  } catch (err) {
    reportError(err instanceof Error ? err : new Error('Pause failed'), 'audioPlayer.pause');
  }
}

export async function seek(positionMillis: number): Promise<void> {
  if (!sound || !state.isLoaded) return;
  
  try {
    await sound.setPositionAsync(Math.max(0, Math.min(positionMillis, state.duration)));
    setState({ position: positionMillis });
  } catch (err) {
    reportError(err instanceof Error ? err : new Error('Seek failed'), 'audioPlayer.seek');
  }
}

export async function setPlaybackRate(rate: number): Promise<void> {
  const clampedRate = Math.max(0.5, Math.min(2.5, rate));
  if (!sound) {
    setState({ playbackRate: clampedRate });
    return;
  }
  
  try {
    await sound.setRateAsync(clampedRate, false);
    setState({ playbackRate: clampedRate });
    
    const localDb = await getLocalDb();
    await localDb.runAsync(
      'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
      ['audio_playback_rate', String(clampedRate)]
    );
  } catch (err) {
    reportError(err instanceof Error ? err : new Error('Rate change failed'), 'audioPlayer.setPlaybackRate');
  }
}

export async function setVolume(volume: number): Promise<void> {
  const clampedVolume = Math.max(0, Math.min(1, volume));
  if (!sound) {
    setState({ volume: clampedVolume });
    return;
  }
  
  try {
    await sound.setVolumeAsync(clampedVolume);
    setState({ volume: clampedVolume });
    
    const localDb = await getLocalDb();
    await localDb.runAsync(
      'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
      ['audio_volume', String(clampedVolume)]
    );
  } catch (err) {
    reportError(err instanceof Error ? err : new Error('Volume change failed'), 'audioPlayer.setVolume');
  }
}

export async function skipForward(seconds = 10): Promise<void> {
  await seek(state.position + seconds * 1000);
}

export async function skipBackward(seconds = 10): Promise<void> {
  await seek(state.position - seconds * 1000);
}

export async function playNextChapter(getNextChapter: (book: number, chapter: number) => { book: number; chapter: number } | null, loadFn: (book: number, chapter: number) => Promise<string | null>): Promise<void> {
  if (!state.currentBook || !state.currentChapter) return;
  
  const next = getNextChapter(state.currentBook, state.currentChapter);
  if (!next) return;
  
  const localPath = await loadFn(next.book, next.chapter);
  if (localPath) {
    await loadChapter(next.book, next.chapter, localPath);
    await play();
  }
}

export async function playPreviousChapter(getPrevChapter: (book: number, chapter: number) => { book: number; chapter: number } | null, loadFn: (book: number, chapter: number) => Promise<string | null>): Promise<void> {
  if (!state.currentBook || !state.currentChapter) return;
  
  const prev = getPrevChapter(state.currentBook, state.currentChapter);
  if (!prev) return;
  
  const localPath = await loadFn(prev.book, prev.chapter);
  if (localPath) {
    await loadChapter(prev.book, prev.chapter, localPath);
    await play();
  }
}

export async function unload(): Promise<void> {
  if (sound) {
    try {
      await sound.unloadAsync();
    } catch {}
    sound = null;
  }
  stopPositionUpdates();
  setState({
    isLoaded: false,
    isPlaying: false,
    position: 0,
    duration: 0,
    currentBook: null,
    currentChapter: null,
    error: null,
  });
}

function onPlaybackStatusUpdate(status: Audio.AudioStatus): void {
  if (!status.isLoaded) {
    if (status.error) {
      setState({ error: status.error, isPlaying: false });
    }
    return;
  }
  
  const wasPlaying = state.isPlaying;
  setState({
    isPlaying: status.isPlaying,
    position: status.positionMillis,
    duration: status.durationMillis,
  });
  
  if (wasPlaying && !status.isPlaying && status.didJustFinish) {
    setState({ isPlaying: false, position: 0 });
  }
}

function startPositionUpdates(): void {
  stopPositionUpdates();
  positionUpdateInterval = setInterval(() => {
    if (sound && state.isLoaded) {
      sound.getStatusAsync().then(status => {
        if (status.isLoaded) {
          setState({
            position: status.positionMillis,
            duration: status.durationMillis,
            isPlaying: status.isPlaying,
          });
        }
      }).catch(() => {});
    }
  }, 500);
}

function stopPositionUpdates(): void {
  if (positionUpdateInterval) {
    clearInterval(positionUpdateInterval);
    positionUpdateInterval = null;
  }
}

export async function getAvailableRates(): Promise<number[]> {
  return [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5];
}

export function formatTime(millis: number): string {
  if (!millis || millis < 0) return '0:00';
  const totalSeconds = Math.floor(millis / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}