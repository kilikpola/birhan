import React from 'react';
import { Text, View } from 'react-native';
import { SectionBoundary } from './section-boundary';
import { ErrorFallback } from './error-fallback';

jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn(() => jest.fn()),
}));

jest.mock('../lib/errors', () => ({
  reportError: jest.fn(),
}));

describe('SectionBoundary Primitives', () => {
  it('exports SectionBoundary and ErrorFallback', () => {
    expect(SectionBoundary).toBeDefined();
    expect(ErrorFallback).toBeDefined();
  });
});
