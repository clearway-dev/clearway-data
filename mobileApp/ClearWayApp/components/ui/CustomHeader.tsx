import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { UIConfig } from '../../config/ui.config';

interface CustomHeaderProps {
  title: string;
  onBack?: () => void;
  onClose?: () => void;
  variant?: 'back' | 'close'; // back = ← for stack navigation, close = ✕ for modals
}

/**
 * Custom header component with consistent navigation behavior
 * 
 * Rules:
 * - Use variant="back" (←) for standard stack navigation screens
 * - Use variant="close" (✕) ONLY for modal screens
 */
export const CustomHeader: React.FC<CustomHeaderProps> = ({
  title,
  onBack,
  onClose,
  variant = 'back',
}) => {
  const handlePress = () => {
    if (variant === 'close' && onClose) {
      onClose();
    } else if (variant === 'back' && onBack) {
      onBack();
    }
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.actionButton}
        onPress={handlePress}
      >
        {variant === 'close' ? (
          <View style={styles.closeButton}>
            <Text style={styles.closeButtonText}>✕</Text>
          </View>
        ) : (
          <Text style={styles.backButtonText}>← Zpět</Text>
        )}
      </TouchableOpacity>
      
      <Text style={styles.title}>{title}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: UIConfig.colors.background,
    paddingTop: UIConfig.safeArea.top,
    paddingBottom: UIConfig.spacing.lg,
    paddingHorizontal: UIConfig.spacing.xl,
    borderBottomWidth: 1,
    borderBottomColor: UIConfig.colors.border,
  },
  actionButton: {
    marginBottom: UIConfig.spacing.sm,
  },
  backButtonText: {
    fontSize: UIConfig.fontSize.md,
    color: UIConfig.colors.primary,
    fontWeight: '600',
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: UIConfig.borderRadius.xxl,
    backgroundColor: UIConfig.colors.muted,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButtonText: {
    fontSize: 24,
    color: UIConfig.colors.foreground,
    fontWeight: '300',
  },
  title: {
    fontSize: UIConfig.fontSize.xxl,
    fontWeight: 'bold',
    color: UIConfig.colors.foreground,
  },
});
