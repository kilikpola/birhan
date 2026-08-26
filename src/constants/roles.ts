export type LayRoleValue =
  | 'member'
  | 'choir'
  | 'choir_leader'
  | 'worship_leader'
  | 'sunday_school'
  | 'youth_leader'
  | 'elder'
  | 'deacon'
  | 'evangelist'
  | 'prayer_leader'
  | 'womens_fellowship'
  | 'mens_fellowship'
  | 'secretary'
  | 'treasurer';

export type ClergyRoleValue = 'qes' | 'pastor' | 'assistant_pastor';

export type ChurchRoleValue = LayRoleValue | ClergyRoleValue;

export type RoleDefinition = {
  value: ChurchRoleValue;
  am: string;
  en: string;
  isClergy: boolean;
};

export const LAY_ROLES: RoleDefinition[] = [
  { value: 'member', am: 'ምዕመን', en: 'Member', isClergy: false },
  { value: 'choir', am: 'መዘምር', en: 'Choir member', isClergy: false },
  { value: 'choir_leader', am: 'የመዘምራን መሪ', en: 'Choir leader', isClergy: false },
  { value: 'worship_leader', am: 'የአምልኮ መሪ', en: 'Worship leader', isClergy: false },
  { value: 'sunday_school', am: 'የሰንበት ትምህርት ቤት አስተማሪ', en: 'Sunday school teacher', isClergy: false },
  { value: 'youth_leader', am: 'የወጣቶች መሪ', en: 'Youth leader', isClergy: false },
  { value: 'elder', am: 'ሽማግሌ', en: 'Elder', isClergy: false },
  { value: 'deacon', am: 'ዲያቆን', en: 'Deacon', isClergy: false },
  { value: 'evangelist', am: 'ወንጌላዊ', en: 'Evangelist', isClergy: false },
  { value: 'prayer_leader', am: 'የጸሎት መሪ', en: 'Prayer leader', isClergy: false },
  { value: 'womens_fellowship', am: 'የሴቶች ኅብረት መሪ', en: "Women's fellowship leader", isClergy: false },
  { value: 'mens_fellowship', am: 'የወንዶች ኅብረት መሪ', en: "Men's fellowship leader", isClergy: false },
  { value: 'secretary', am: 'ጸሐፊ', en: 'Secretary', isClergy: false },
  { value: 'treasurer', am: 'ገንዘብ ያዥ', en: 'Treasurer', isClergy: false },
];

export const CLERGY_ROLE_QES: RoleDefinition = {
  value: 'qes',
  am: 'ቄስ',
  en: 'Qes (Reverend)',
  isClergy: true,
};

export const CLERGY_ROLES_STANDARD: RoleDefinition[] = [
  { value: 'pastor', am: 'ፓስተር', en: 'Pastor', isClergy: true },
  { value: 'assistant_pastor', am: 'ረዳት ፓስተር', en: 'Assistant Pastor', isClergy: true },
];

/**
 * Checks if a church denomination is EECMY (Ethiopian Evangelical Church Mekane Yesus).
 */
export function isEecmyDenomination(denomination?: string | null): boolean {
  if (!denomination) return false;
  const lower = denomination.toLowerCase();
  return lower.includes('eecmy') || lower.includes('mekane_yesus') || lower.includes('mekane yesus');
}

/**
 * Returns available clergy roles for a specific church denomination.
 * For EECMY -> Qes (Reverend)
 * For other denominations -> Pastor, Assistant Pastor
 */
export function getClergyRolesForDenomination(denomination?: string | null): RoleDefinition[] {
  if (isEecmyDenomination(denomination)) {
    return [CLERGY_ROLE_QES];
  }
  return CLERGY_ROLES_STANDARD;
}

/**
 * Returns available lay roles for member registration (excluding clergy roles).
 */
export function getAllRolesForDenomination(_denomination?: string | null): RoleDefinition[] {
  return LAY_ROLES;
}

export function isClergyRole(roleValue?: string | null): boolean {
  return roleValue === 'qes' || roleValue === 'pastor' || roleValue === 'assistant_pastor';
}
