/**
 * UI Theme Configuration
 * 
 * Centralized theme values for consistent UI across the app
 */

export const UIConfig = {
  /**
   * Spacing values (in pixels)
   */
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    xxl: 24,
    xxxl: 40,
  },

  /**
   * Border radius values (in pixels)
   */
  borderRadius: {
    sm: 6,
    md: 8,
    lg: 12,
    xl: 16,
    xxl: 20,
    round: 50, // for circular elements
  },

  /**
   * Font sizes (in pixels)
   */
  fontSize: {
    xs: 12,
    sm: 14,
    md: 16,
    lg: 20,
    xl: 24,
    xxl: 28,
    xxxl: 48,
  },

  /**
   * Colors from shadcn/ui palette
   */
  colors: {
    // Primary
    background: '#ffffff',
    foreground: '#18181b',
    
    // Muted
    muted: '#f4f4f5',
    mutedForeground: '#71717a',
    
    // Card
    card: '#ffffff',
    cardBorder: '#e4e4e7',
    
    // Border
    border: '#e4e4e7',
    input: '#d1d5db',
    
    // Primary blue
    primary: '#3b82f6',
    primaryForeground: '#ffffff',
    
    // Secondary
    secondary: '#f4f4f5',
    secondaryForeground: '#18181b',
    
    // Destructive (red)
    destructive: '#dc2626',
    destructiveForeground: '#ffffff',
    destructiveLight: '#fee2e2',
    destructiveBorder: '#fecaca',
    
    // Success (green)
    success: '#16a34a',
    successLight: '#dcfce7',
    successForeground: '#ffffff',
    
    // Warning (yellow)
    warning: '#f59e0b',
    warningLight: '#fef3c7',
    warningForeground: '#92400e',
    
    // Info (blue)
    info: '#1e40af',
    infoLight: '#dbeafe',
    
    // Accent
    accent: '#f4f4f5',
    accentForeground: '#18181b',
  },

  /**
   * Safe area padding (for iOS notch, etc.)
   */
  safeArea: {
    top: 50,
    bottom: 20,
  },

  /**
   * Header heights
   */
  header: {
    height: 80,
  },

  /**
   * Button min heights for touch targets
   */
  button: {
    minHeight: 44,
  },
} as const;
