export const MEALS = ['breakfast', 'lunch', 'dinner', 'snacks'];

export const MEAL_ICONS = {
  breakfast: '🌅',
  lunch: '☀️',
  dinner: '🌙',
  snacks: '🍿',
};

export const MEAL_LABELS = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snacks: 'Snacks',
};

export const ACTIVITY_LEVELS = [
  { value: 1.2, label: 'Sedentary', desc: 'Little or no exercise' },
  { value: 1.375, label: 'Light', desc: 'Exercise 1-3 days/week' },
  { value: 1.55, label: 'Moderate', desc: 'Exercise 3-5 days/week' },
  { value: 1.725, label: 'Active', desc: 'Exercise 6-7 days/week' },
  { value: 1.9, label: 'Very Active', desc: 'Intense daily exercise' },
];

export const WEEKLY_GOALS = [
  { value: 0, label: 'Maintain weight' },
  { value: -250, label: 'Lose 0.25kg/week' },
  { value: -500, label: 'Lose 0.5kg/week' },
  { value: -750, label: 'Lose 0.75kg/week' },
  { value: -1000, label: 'Lose 1kg/week' },
];

/** Returns YYYY-MM-DD for a given date (defaults to today) */
export function dateKey(d = new Date()) {
  return d.toISOString().split('T')[0];
}

/** Formats a YYYY-MM-DD string to something human-readable */
export function formatDate(ds) {
  const d = new Date(ds + 'T12:00:00');
  return d.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/** Mifflin-St Jeor TDEE calculation */
export function calcTDEE(profile) {
  const { gender, weightKg, heightCm, age, activityLevel } = profile;
  let bmr;
  if (gender === 'male') {
    bmr = 10 * weightKg + 6.25 * heightCm - 5 * age + 5;
  } else {
    bmr = 10 * weightKg + 6.25 * heightCm - 5 * age - 161;
  }
  return Math.round(bmr * activityLevel);
}
