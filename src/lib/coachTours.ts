import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * First-run coach-mark tours: which ones a person has already seen.
 *
 * One flag per tour, so tours can be added without disturbing existing ones,
 * and "replay the guide" is just clearing the flags. Storage failures fail
 * safe — a tour that can't read its flag simply does not auto-show (better than
 * popping the overlay on every launch).
 */

const PREFIX = 'birhan:tour_';

export type TourId = 'bible';

export const ALL_TOURS: TourId[] = ['bible'];

export async function hasSeenTour(id: TourId): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(PREFIX + id)) === '1';
  } catch {
    return true; // storage trouble: don't nag
  }
}

export async function markTourSeen(id: TourId): Promise<void> {
  try {
    await AsyncStorage.setItem(PREFIX + id, '1');
  } catch {
    // A failed write just means it may show once more next launch — harmless.
  }
}

/** Clears every tour flag so they play again — the "replay the guide" action. */
export async function resetAllTours(): Promise<void> {
  try {
    await AsyncStorage.multiRemove(ALL_TOURS.map((id) => PREFIX + id));
  } catch {
    // ignore
  }
}
