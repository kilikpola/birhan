/**
 * Audio manifest mapping GitHub release filenames to Bible book/chapter
 * Generated from the Amharic NASV Audio Bible release (audio-v1 + audio-v1-patch)
 * Files are named as BOOK_NNN.mp3 where BOOK is standard 3-letter abbreviation
 */

import * as FileSystem from 'expo-file-system';

export interface AudioChapter {
  bookId: number;
  chapter: number;
  filename: string;
  size: number;
  url: string;
}

export const BOOK_ABBREV_TO_ID: Record<string, number> = {
  // Old Testament
  GEN: 1,
  EXO: 2,
  LEV: 3,
  NUM: 4,
  DEU: 5,
  JOS: 6,
  JDG: 7,
  RUT: 8,
  '1SA': 9,
  '2SA': 10,
  '1KI': 11,
  '2KI': 12,
  '1CH': 13,
  '2CH': 14,
  EZR: 15,
  NEH: 16,
  EST: 17,
  JOB: 18,
  PSA: 19,
  PRO: 20,
  ECC: 21,
  SNG: 22,
  ISA: 23,
  JER: 24,
  LAM: 25,
  EZK: 26,
  DAN: 27,
  HOS: 28,
  JOL: 29,
  AMO: 30,
  OBA: 31,
  JON: 32,
  MIC: 33,
  NAM: 34,
  HAB: 35,
  ZEP: 36,
  HAG: 37,
  ZEC: 38,
  MAL: 39,
  // New Testament
  MAT: 40,
  MRK: 41,
  LUK: 42,
  JHN: 43,
  ACT: 44,
  ROM: 45,
  '1CO': 46,
  '2CO': 47,
  GAL: 48,
  EPH: 49,
  PHP: 50,
  COL: 51,
  '1TH': 52,
  '2TH': 53,
  '1TI': 54,
  '2TI': 55,
  TIT: 56,
  PHM: 57,
  HEB: 58,
  JAS: 59,
  '1PE': 60,
  '2PE': 61,
  '1JN': 62,
  '2JN': 63,
  '3JN': 64,
  JUD: 65,
  REV: 66,
};

export const BOOK_CHAPTER_COUNTS: Record<number, number> = {
  1: 50, 2: 40, 3: 27, 4: 36, 5: 34, 6: 24, 7: 21, 8: 4,
  9: 31, 10: 24, 11: 22, 12: 25, 13: 29, 14: 36, 15: 10, 16: 13,
  17: 10, 18: 42, 19: 150, 20: 31, 21: 12, 22: 8,
  23: 66, 24: 52, 25: 5, 26: 48, 27: 12, 28: 14, 29: 3, 30: 9,
  31: 1, 32: 4, 33: 7, 34: 3, 35: 3, 36: 3, 37: 2, 38: 14, 39: 4,
  40: 28, 41: 16, 42: 24, 43: 21, 44: 28, 45: 16, 46: 16, 47: 13,
  48: 6, 49: 6, 50: 4, 51: 4, 52: 5, 53: 3, 54: 6, 55: 4,
  56: 3, 57: 1, 58: 13, 59: 5, 60: 5, 61: 3, 62: 5, 63: 1,
  64: 1, 65: 1, 66: 22,
};

export function parseAudioFilename(filename: string): { bookId: number; chapter: number } | null {
  const match = filename.match(/^([1-3]?[A-Z]{2,3})_(\d{3})\.mp3$/);
  if (!match) return null;
  const [, abbrev, chapterStr] = match;
  const bookId = BOOK_ABBREV_TO_ID[abbrev];
  if (!bookId) return null;
  const chapter = parseInt(chapterStr, 10);
  if (chapter < 1 || chapter > (BOOK_CHAPTER_COUNTS[bookId] || 150)) return null;
  return { bookId, chapter };
}

export function getAudioUrl(bookId: number, chapter: number): string {
  const abbrev = Object.entries(BOOK_ABBREV_TO_ID).find(([, id]) => id === bookId)?.[0];
  if (!abbrev) return '';
  return `https://github.com/kalelbethel-kalkord/bible-app-assets/releases/download/audio-v1/${abbrev}_${String(chapter).padStart(3, '0')}.mp3`;
}

export function getPatchAudioUrl(bookId: number, chapter: number): string {
  const abbrev = Object.entries(BOOK_ABBREV_TO_ID).find(([, id]) => id === bookId)?.[0];
  if (!abbrev) return '';
  return `https://github.com/kalelbethel-kalkord/bible-app-assets/releases/download/audio-v1-patch/${abbrev}_${String(chapter).padStart(3, '0')}.mp3`;
}

export function getLocalAudioPath(filename: string): string {
  return `${FileSystem.documentDirectory}audio/${filename}`;
}