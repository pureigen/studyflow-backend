// 한글 자판을 영문 자판으로 변환
export function koreanKeyboardToEnglish(korean: string): string {
  const keyMap: { [key: string]: string } = {
    'ㅂ': 'q', 'ㅈ': 'w', 'ㄷ': 'e', 'ㄱ': 'r', 'ㅅ': 't',
    'ㅛ': 'y', 'ㅕ': 'u', 'ㅑ': 'i', 'ㅐ': 'o', 'ㅔ': 'p',
    'ㅁ': 'a', 'ㄴ': 's', 'ㅇ': 'd', 'ㄹ': 'f', 'ㅎ': 'g',
    'ㅗ': 'h', 'ㅓ': 'j', 'ㅏ': 'k', 'ㅣ': 'l',
    'ㅋ': 'z', 'ㅌ': 'x', 'ㅊ': 'c', 'ㅍ': 'v', 'ㅠ': 'b',
    'ㅜ': 'n', 'ㅡ': 'm',
    'ㅃ': 'Q', 'ㅉ': 'W', 'ㄸ': 'E', 'ㄲ': 'R', 'ㅆ': 'T',
    'ㅒ': 'O', 'ㅖ': 'P'
  };
  
  let result = '';
  for (let i = 0; i < korean.length; i++) {
    const char = korean[i];
    const code = char.charCodeAt(0);
    
    if (code >= 48 && code <= 57) {
      result += char;
    } else if (code >= 0xAC00 && code <= 0xD7A3) {
      const baseCode = code - 0xAC00;
      const jongseong = baseCode % 28;
      const jungseong = ((baseCode - jongseong) / 28) % 21;
      const choseong = ((baseCode - jongseong) / 28 - jungseong) / 21;
      
      const choList = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
      const jungList = ['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ','ㅙ','ㅚ','ㅛ','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ'];
      const jongList = ['','ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
      
      result += keyMap[choList[choseong]] || '';
      result += keyMap[jungList[jungseong]] || '';
      if (jongseong > 0) {
        result += keyMap[jongList[jongseong]] || '';
      }
    } else {
      result += char.toLowerCase();
    }
  }
  
  return result;
}

// 학생 이메일 생성
export function createStudentEmail(username: string): string {
  const trimmed = username.trim();
  const hasKorean = /[가-힣]/.test(trimmed);
  
  if (hasKorean) {
    const converted = koreanKeyboardToEnglish(trimmed);
    return `${converted}@students.local`;
  } else {
    return `${trimmed.toLowerCase()}@students.local`;
  }
}