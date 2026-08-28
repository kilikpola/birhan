export type StudyBook = {
  id: number;
  name_am: string;
  name_en: string;
};

export type StudyVerseRef = {
  book: number;
  bookNameAm: string;
  bookNameEn: string;
  chapter: number;
  verse: number;
  textAm: string;
  textEn: string;
};

export type NavigateTarget = { book: number; chapter: number; verse: number };
