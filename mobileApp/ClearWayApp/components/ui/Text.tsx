import React from 'react';
import { Text as RNText, StyleSheet, TextProps as RNTextProps } from 'react-native';

interface TextProps extends RNTextProps {
  variant?: 'h1' | 'h2' | 'h3' | 'body' | 'label' | 'caption';
  children: React.ReactNode;
}

export const Text: React.FC<TextProps> = ({ 
  variant = 'body', 
  children, 
  style, 
  ...props 
}) => {
  return (
    <RNText style={[styles[variant], style]} {...props}>
      {children}
    </RNText>
  );
};

const styles = StyleSheet.create({
  h1: {
    fontSize: 32,
    fontWeight: '700',
    color: '#18181b',
    letterSpacing: -0.5,
    lineHeight: 40,
  },
  h2: {
    fontSize: 24,
    fontWeight: '600',
    color: '#18181b',
    letterSpacing: -0.3,
    lineHeight: 32,
  },
  h3: {
    fontSize: 18,
    fontWeight: '600',
    color: '#18181b',
    letterSpacing: 0,
    lineHeight: 24,
  },
  body: {
    fontSize: 16,
    fontWeight: '400',
    color: '#3f3f46',
    lineHeight: 24,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: '#71717a',
    lineHeight: 20,
  },
  caption: {
    fontSize: 12,
    fontWeight: '400',
    color: '#a1a1aa',
    lineHeight: 16,
  },
});
