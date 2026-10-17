import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { UIConfig } from '../../config/ui.config';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Smaller second line under the label. */
  hint?: string;
}

interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  testIDPrefix?: string;
}

/** Two-or-three-way switch, used for the data mode and the firmware generation. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  disabled = false,
  testIDPrefix,
}: SegmentedProps<T>) {
  return (
    <View style={[styles.row, disabled && styles.disabled]}>
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <TouchableOpacity
            key={option.value}
            testID={testIDPrefix ? `${testIDPrefix}-${option.value}` : undefined}
            style={[
              styles.segment,
              index === 0 && styles.first,
              index === options.length - 1 && styles.last,
              selected && styles.selected,
            ]}
            onPress={() => onChange(option.value)}
            disabled={disabled}
            activeOpacity={0.8}
            accessibilityState={{ selected, disabled }}
          >
            <Text style={[styles.label, selected && styles.selectedText]}>{option.label}</Text>
            {option.hint ? <Text style={[styles.hint, selected && styles.selectedHint]}>{option.hint}</Text> : null}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    borderRadius: UIConfig.borderRadius.md,
    borderWidth: 1,
    borderColor: UIConfig.colors.input,
    overflow: 'hidden',
  },
  disabled: {
    opacity: 0.5,
  },
  segment: {
    flex: 1,
    paddingVertical: UIConfig.spacing.md,
    paddingHorizontal: UIConfig.spacing.sm,
    alignItems: 'center',
    backgroundColor: UIConfig.colors.muted,
    borderLeftWidth: 1,
    borderLeftColor: UIConfig.colors.input,
  },
  first: {
    borderLeftWidth: 0,
  },
  last: {},
  selected: {
    backgroundColor: UIConfig.colors.foreground,
  },
  label: {
    fontSize: UIConfig.fontSize.sm,
    fontWeight: '700',
    color: UIConfig.colors.foreground,
  },
  selectedText: {
    color: '#ffffff',
  },
  hint: {
    fontSize: UIConfig.fontSize.xs,
    color: UIConfig.colors.mutedForeground,
    marginTop: 2,
    textAlign: 'center',
  },
  selectedHint: {
    color: '#d4d4d8',
  },
});
