// Test script to verify URL parsing in deleteStoredFile

const testCases = [
  // Full URLs
  'http://localhost:3001/uploads/avatars/user123/file.png',
  'https://domain.com/uploads/avatars/user456/avatar.jpg',

  // Relative paths
  '/uploads/avatars/user789/profile.webp',

  // External URLs (should be skipped)
  'https://lh3.googleusercontent.com/a/profile-picture',
  'https://example.com/some-other-path/image.png',

  // Invalid formats
  null,
  undefined,
  '',
  'not-a-url',
];

function extractPath(publicPath?: string | null): string | null {
  if (!publicPath) return null;

  let pathToDelete = publicPath;

  if (publicPath.startsWith('http://') || publicPath.startsWith('https://')) {
    try {
      const url = new URL(publicPath);
      pathToDelete = url.pathname;
    } catch {
      return null;
    }
  }

  if (!pathToDelete.startsWith('/uploads/')) return null;

  return pathToDelete;
}

console.log('Testing URL path extraction:\n');

testCases.forEach((testCase) => {
  const result = extractPath(testCase);
  const input = testCase === null ? 'null' : testCase === undefined ? 'undefined' : `"${testCase}"`;
  const output = result === null ? 'SKIP (null)' : `"${result}"`;

  console.log(`Input:  ${input}`);
  console.log(`Output: ${output}`);
  console.log('---');
});
