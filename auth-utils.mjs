export function getPasswordError(password) {
     if (typeof password !== 'string' || password.length < 6) return 'Password must contain at least 6 characters.';
     if (password.length > 128) return 'Password cannot exceed 128 characters.';
     if (!/[A-Z]/.test(password)) return 'Password must contain an uppercase letter.';
     if (!/[a-z]/.test(password)) return 'Password must contain a lowercase letter.';
     return null;
}

