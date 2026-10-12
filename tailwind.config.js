/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Pretendard Variable"', 'Pretendard', '-apple-system', 'BlinkMacSystemFont', 'system-ui', '"Apple SD Gothic Neo"', '"Malgun Gothic"', 'sans-serif'],
        // 숫자·영문은 Plex Mono, 한글은 Pretendard로 표시
        mono: ['"IBM Plex Mono"', '"Pretendard Variable"', 'Pretendard', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};
