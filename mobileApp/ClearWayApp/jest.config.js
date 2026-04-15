/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',

  // Runs after the test environment is set up (correct Jest 29 key name).
  setupFilesAfterEnv: ['./jest.setup.ts'],

  testMatch: ['**/__tests__/**/*.test.(ts|tsx)'],

  // Expo and React Native packages ship untranspiled — must be included here.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/(?!.*utils)|@expo-google-fonts|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg)',
  ],

  moduleNameMapper: {
    // Official in-memory AsyncStorage mock.
    '^@react-native-async-storage/async-storage$':
      '@react-native-async-storage/async-storage/jest/async-storage-mock',
    // expo-sqlite uses native APIs that are not available in the Jest JSDOM/Node
    // environment. Map the entire package (including sub-paths) to a manual mock
    // so any file that imports it gets a predictable in-memory stub.
    '^expo-sqlite$': '<rootDir>/__mocks__/expo-sqlite.ts',
    '^expo-sqlite/.*$': '<rootDir>/__mocks__/expo-sqlite.ts',
  },

  collectCoverageFrom: [
    'services/**/*.ts',
    'hooks/**/*.ts',
    'contexts/**/*.tsx',
    'screens/**/*.tsx',
    '!**/*.d.ts',
  ],

  coverageThreshold: {
    global: {
      branches: 60,
      functions: 70,
      lines: 70,
    },
  },
};
