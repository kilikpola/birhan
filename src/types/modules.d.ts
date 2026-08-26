declare module 'expo-updates' {
  export const isEnabled: boolean;
  export function checkForUpdateAsync(): Promise<{ isAvailable: boolean }>;
  export function fetchUpdateAsync(): Promise<{ isNew: boolean }>;
  export function reloadAsync(): Promise<void>;
}

declare module 'expo-network' {
  export enum NetworkStateType {
    NONE = 'NONE',
    UNKNOWN = 'UNKNOWN',
    CELLULAR = 'CELLULAR',
    WIFI = 'WIFI',
    BLUETOOTH = 'BLUETOOTH',
    ETHERNET = 'ETHERNET',
    WIMAX = 'WIMAX',
    VPN = 'VPN',
    OTHER = 'OTHER',
  }
  export function getNetworkStateAsync(): Promise<{
    type: NetworkStateType;
    isConnected: boolean;
    isInternetReachable?: boolean;
  }>;
}

declare module 'expo-crypto' {
  export enum CryptoDigestAlgorithm {
    SHA256 = 'SHA-256',
    SHA384 = 'SHA-384',
    SHA512 = 'SHA-512',
    MD5 = 'MD5',
    SHA1 = 'SHA-1',
  }
  export function digestStringAsync(
    algorithm: CryptoDigestAlgorithm,
    data: string
  ): Promise<string>;
}

declare module 'expo-intent-launcher' {
  export const ACTION_VIEW: string;
  export function startActivityAsync(
    activity: string,
    data?: { data?: string; flags?: number; type?: string }
  ): Promise<any>;
}

declare module 'expo-application' {
  export const nativeBuildVersion: string | null;
  export const nativeApplicationVersion: string | null;
}
