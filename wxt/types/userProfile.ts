/**
 * User Profile Types for IEEE Extension
 */

export interface UserProfile {
  theme: ThemeSettings;
  interactions: InteractionSettings;
}

export interface ThemeSettings {
  // Color preferences
  primaryColor: string;
  backgroundColor: string;
  textColor: string;
  highlightColor: string;

  // Accessibility settings
  highContrast: boolean;
  colorBlindMode: ColorBlindMode;

  // Typography
  fontSize: FontSize;
  fontFamily: string;
  lineHeight: number;
  letterSpacing: string;

  // Spacing
  spacing: SpacingMode;
}

export interface InteractionSettings {
  highlightOnHover: boolean;
  showTooltips: boolean;
}

export type ColorBlindMode = 'none' | 'protanopia' | 'deuteranopia' | 'tritanopia';
export type FontSize = 'small' | 'medium' | 'large' | 'x-large';
export type SpacingMode = 'compact' | 'normal' | 'comfortable';
