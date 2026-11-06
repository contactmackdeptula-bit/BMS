// SPEC.md §3.6: minimum 10 characters, not a common password.
const COMMON = new Set([
  "password", "password1", "password12", "password123", "password1234", "passw0rd", "123456789",
  "1234567890", "12345678910", "qwertyuiop", "qwerty123", "qwerty1234", "iloveyou1", "letmein123",
  "welcome123", "welcome1234", "admin12345", "abc1234567", "football123", "sunshine12", "princess12",
  "churchwarden", "stpeterandstpaul", "jesuslovesme", "godisgood1", "amazinggrace", "hallelujah",
  "hallelujah1", "blessed123", "faithful123", "fareham123", "1qaz2wsx3edc", "aaaaaaaaaa", "0000000000",
]);

export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < 10) return "Use at least 10 characters.";
  if (password.length > 200) return "Use 200 characters or fewer.";
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return "That password is too common. Try a short phrase of a few words.";
  if (email && lower === email.toLowerCase()) return "Don't use your email address as your password.";
  return null;
}
