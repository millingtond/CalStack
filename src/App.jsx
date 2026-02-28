import { useState, useEffect, useCallback, useRef } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { load, save, clearAll, setUid } from './storage';
import { waitForAuth } from './firebase';
import {
  MEALS, MEAL_ICONS, MEAL_LABELS, ACTIVITY_LEVELS, WEEKLY_GOALS,
  dateKey, formatDate, calcTDEE,
} from './constants';

/* ─── Small UI components ────────────────────────────────────────────────── */

function CalorieRing({ consumed, target, size = 190 }) {
  const stroke = 12;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.min(consumed / target, 1.5);
  const offset = circumference - pct * circumference;
  const remaining = target - consumed;
  const over = remaining < 0;

  return (
    <div className="flex items-center justify-center" style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(0,0,0,0.06)" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke={over ? '#ef4444' : pct > 0.85 ? '#f59e0b' : '#10b981'}
          strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.8s ease, stroke 0.3s ease' }}
        />
      </svg>
      <div style={{ position: 'absolute', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <span style={{ fontSize: 13, color: '#94a3b8', fontWeight: 500, letterSpacing: 1, textTransform: 'uppercase' }}>
          {over ? 'Over by' : 'Remaining'}
        </span>
        <span style={{ fontSize: 36, fontWeight: 700, lineHeight: 1.1, color: over ? '#ef4444' : '#1e293b' }}>
          {Math.abs(remaining)}
        </span>
        <span style={{ fontSize: 13, color: '#94a3b8', fontWeight: 500 }}>kcal</span>
      </div>
    </div>
  );
}

function MacroBar({ label, value, target, color, unit = 'g' }) {
  const pct = target > 0 ? Math.min((value / target) * 100, 100) : 0;
  return (
    <div className="flex-1">
      <div className="flex justify-between items-center mb-1">
        <span style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</span>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>{Math.round(value)}/{target}{unit}</span>
      </div>
      <div style={{ height: 6, backgroundColor: 'rgba(0,0,0,0.06)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, backgroundColor: color, borderRadius: 3, transition: 'width 0.6s ease' }} />
      </div>
    </div>
  );
}

function FoodItem({ product, onAdd }) {
  const name = product.product_name || 'Unknown Product';
  const brand = product.brands || '';
  const n = product.nutriments || {};
  const cal = Math.round(n['energy-kcal_100g'] || n['energy-kcal'] || 0);

  return (
    <div
      onClick={() => onAdd({
        id: product.code || Date.now().toString(),
        name, brand,
        caloriesPer100: cal,
        proteinPer100: n.proteins_100g || 0,
        carbsPer100: n.carbohydrates_100g || 0,
        fatPer100: n.fat_100g || 0,
      })}
      style={{ padding: '14px 16px', cursor: 'pointer', borderBottom: '1px solid rgba(0,0,0,0.05)', transition: 'background-color 0.15s ease' }}
      onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.02)')}
      onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
    >
      <div className="flex justify-between items-start">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
          {brand && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{brand}</div>}
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#f97316', marginLeft: 12, flexShrink: 0 }}>{cal} kcal</div>
      </div>
      <div className="flex gap-3 mt-2">
        <span style={{ fontSize: 11, color: '#64748b' }}>P: {Math.round(n.proteins_100g || 0)}g</span>
        <span style={{ fontSize: 11, color: '#64748b' }}>C: {Math.round(n.carbohydrates_100g || 0)}g</span>
        <span style={{ fontSize: 11, color: '#64748b' }}>F: {Math.round(n.fat_100g || 0)}g</span>
        <span style={{ fontSize: 11, color: '#94a3b8' }}>per 100g</span>
      </div>
    </div>
  );
}

/* ─── Modals ─────────────────────────────────────────────────────────────── */

function PortionModal({ food, meal, onConfirm, onClose }) {
  const [grams, setGrams] = useState('100');
  const g = parseFloat(grams) || 0;
  const mult = g / 100;

  const entry = {
    ...food, grams: g, meal, timestamp: Date.now(),
    calories: Math.round(food.caloriesPer100 * mult),
    protein: +(food.proteinPer100 * mult).toFixed(1),
    carbs: +(food.carbsPer100 * mult).toFixed(1),
    fat: +(food.fatPer100 * mult).toFixed(1),
  };

  const inputStyle = {
    flex: 1, padding: '10px 14px', fontSize: 18, fontWeight: 600, borderRadius: 12,
    border: '2px solid #e2e8f0', outline: 'none',
  };

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000, padding: 16 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, backgroundColor: '#fff', borderRadius: 20, padding: 24, boxShadow: '0 -8px 40px rgba(0,0,0,0.15)' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#1e293b', marginBottom: 4 }}>{food.name}</div>
        {food.brand && <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 16 }}>{food.brand}</div>}

        <label style={{ fontSize: 13, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 6 }}>Serving size (grams)</label>
        <div className="flex gap-2 mb-4">
          <input type="number" value={grams} onChange={e => setGrams(e.target.value)} autoFocus style={inputStyle}
            onFocus={e => (e.target.style.borderColor = '#f97316')} onBlur={e => (e.target.style.borderColor = '#e2e8f0')} />
          <span style={{ padding: '10px 0', fontSize: 16, color: '#94a3b8', fontWeight: 500 }}>g</span>
        </div>

        <div className="flex gap-2 mb-5">
          {[25, 50, 100, 150, 200].map(v => (
            <button key={v} onClick={() => setGrams(String(v))} style={{
              flex: 1, padding: '8px 4px', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer',
              border: grams === String(v) ? '2px solid #f97316' : '2px solid #e2e8f0',
              backgroundColor: grams === String(v) ? '#fff7ed' : '#fff',
              color: grams === String(v) ? '#f97316' : '#64748b',
            }}>{v}g</button>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, padding: 16, backgroundColor: '#f8fafc', borderRadius: 14, marginBottom: 20 }}>
          {[
            { label: 'Calories', val: entry.calories, color: '#f97316' },
            { label: 'Protein', val: entry.protein, color: '#3b82f6' },
            { label: 'Carbs', val: entry.carbs, color: '#8b5cf6' },
            { label: 'Fat', val: entry.fat, color: '#ef4444' },
          ].map(m => (
            <div key={m.label} className="text-center">
              <div style={{ fontSize: 20, fontWeight: 700, color: m.color }}>{m.val}</div>
              <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{m.label}</div>
            </div>
          ))}
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} style={{ flex: 1, padding: 14, borderRadius: 14, fontSize: 15, fontWeight: 600, border: '2px solid #e2e8f0', backgroundColor: '#fff', color: '#64748b', cursor: 'pointer' }}>Cancel</button>
          <button onClick={() => onConfirm(entry)} style={{ flex: 2, padding: 14, borderRadius: 14, fontSize: 15, fontWeight: 700, border: 'none', backgroundColor: '#f97316', color: '#fff', cursor: 'pointer', boxShadow: '0 4px 14px rgba(249,115,22,0.3)' }}>Add to {MEAL_LABELS[meal]}</button>
        </div>
      </div>
    </div>
  );
}

function QuickAddModal({ meal, onConfirm, onClose }) {
  const [name, setName] = useState('');
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');

  const handleSubmit = () => {
    if (!name || !calories) return;
    onConfirm({
      id: Date.now().toString(), name, brand: 'Quick add', grams: 0, meal, timestamp: Date.now(),
      calories: parseInt(calories) || 0, protein: parseFloat(protein) || 0,
      carbs: parseFloat(carbs) || 0, fat: parseFloat(fat) || 0,
    });
  };

  const inputStyle = {
    width: '100%', padding: '10px 14px', fontSize: 15, borderRadius: 12,
    border: '2px solid #e2e8f0', outline: 'none', boxSizing: 'border-box',
  };

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000, padding: 16 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, backgroundColor: '#fff', borderRadius: 20, padding: 24, boxShadow: '0 -8px 40px rgba(0,0,0,0.15)' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#1e293b', marginBottom: 16 }}>Quick Add to {MEAL_LABELS[meal]}</div>
        <div className="flex flex-col gap-3 mb-5">
          <input placeholder="Food name *" value={name} onChange={e => setName(e.target.value)} style={inputStyle} autoFocus
            onFocus={e => (e.target.style.borderColor = '#f97316')} onBlur={e => (e.target.style.borderColor = '#e2e8f0')} />
          <input placeholder="Calories (kcal) *" type="number" value={calories} onChange={e => setCalories(e.target.value)} style={inputStyle}
            onFocus={e => (e.target.style.borderColor = '#f97316')} onBlur={e => (e.target.style.borderColor = '#e2e8f0')} />
          <div className="flex gap-2">
            <input placeholder="Protein (g)" type="number" value={protein} onChange={e => setProtein(e.target.value)} style={inputStyle}
              onFocus={e => (e.target.style.borderColor = '#f97316')} onBlur={e => (e.target.style.borderColor = '#e2e8f0')} />
            <input placeholder="Carbs (g)" type="number" value={carbs} onChange={e => setCarbs(e.target.value)} style={inputStyle}
              onFocus={e => (e.target.style.borderColor = '#f97316')} onBlur={e => (e.target.style.borderColor = '#e2e8f0')} />
            <input placeholder="Fat (g)" type="number" value={fat} onChange={e => setFat(e.target.value)} style={inputStyle}
              onFocus={e => (e.target.style.borderColor = '#f97316')} onBlur={e => (e.target.style.borderColor = '#e2e8f0')} />
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} style={{ flex: 1, padding: 14, borderRadius: 14, fontSize: 15, fontWeight: 600, border: '2px solid #e2e8f0', backgroundColor: '#fff', color: '#64748b', cursor: 'pointer' }}>Cancel</button>
          <button onClick={handleSubmit} style={{
            flex: 2, padding: 14, borderRadius: 14, fontSize: 15, fontWeight: 700, border: 'none', backgroundColor: '#f97316',
            color: '#fff', cursor: 'pointer', opacity: (!name || !calories) ? 0.5 : 1, boxShadow: '0 4px 14px rgba(249,115,22,0.3)',
          }}>Add Entry</button>
        </div>
      </div>
    </div>
  );
}

/* ─── Onboarding ─────────────────────────────────────────────────────────── */

function Onboarding({ onComplete }) {
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState({
    name: '', gender: 'male', age: 30, heightCm: 175, weightKg: 80,
    activityLevel: 1.375, weeklyGoalOffset: -500,
  });

  const update = (k, v) => setProfile(p => ({ ...p, [k]: v }));
  const tdee = calcTDEE(profile);
  const target = tdee + profile.weeklyGoalOffset;

  const inputStyle = {
    width: '100%', padding: '14px 16px', fontSize: 16, borderRadius: 14,
    border: '2px solid #e2e8f0', outline: 'none', boxSizing: 'border-box',
  };

  const steps = [
    <div key="0">
      <div style={{ fontSize: 48, marginBottom: 16 }}>🔥</div>
      <h1 style={{ fontSize: 28, fontWeight: 800, color: '#1e293b', marginBottom: 8 }}>Let's set up your tracker</h1>
      <p style={{ fontSize: 15, color: '#94a3b8', marginBottom: 32, lineHeight: 1.5 }}>
        We'll calculate your daily calorie target based on a few details about you. Your data syncs automatically via Firebase.
      </p>
      <label style={{ fontSize: 13, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 6 }}>Your name</label>
      <input value={profile.name} onChange={e => update('name', e.target.value)} placeholder="Enter your name" style={inputStyle} autoFocus
        onFocus={e => (e.target.style.borderColor = '#f97316')} onBlur={e => (e.target.style.borderColor = '#e2e8f0')} />
    </div>,

    <div key="1">
      <h2 style={{ fontSize: 22, fontWeight: 700, color: '#1e293b', marginBottom: 24 }}>About you</h2>
      <label style={{ fontSize: 13, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 8 }}>Gender</label>
      <div className="flex gap-3 mb-5">
        {['male', 'female'].map(g => (
          <button key={g} onClick={() => update('gender', g)} style={{
            flex: 1, padding: 14, borderRadius: 14, fontSize: 15, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize',
            border: profile.gender === g ? '2px solid #f97316' : '2px solid #e2e8f0',
            backgroundColor: profile.gender === g ? '#fff7ed' : '#fff',
            color: profile.gender === g ? '#f97316' : '#64748b',
          }}>{g}</button>
        ))}
      </div>
      <label style={{ fontSize: 13, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 6 }}>Age</label>
      <input type="number" value={profile.age} onChange={e => update('age', parseInt(e.target.value) || 0)} style={inputStyle}
        onFocus={e => (e.target.style.borderColor = '#f97316')} onBlur={e => (e.target.style.borderColor = '#e2e8f0')} />
    </div>,

    <div key="2">
      <h2 style={{ fontSize: 22, fontWeight: 700, color: '#1e293b', marginBottom: 24 }}>Measurements</h2>
      <label style={{ fontSize: 13, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 6 }}>Height (cm)</label>
      <input type="number" value={profile.heightCm} onChange={e => update('heightCm', parseFloat(e.target.value) || 0)}
        style={{ ...inputStyle, marginBottom: 16 }}
        onFocus={e => (e.target.style.borderColor = '#f97316')} onBlur={e => (e.target.style.borderColor = '#e2e8f0')} />
      <label style={{ fontSize: 13, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 6 }}>Weight (kg)</label>
      <input type="number" value={profile.weightKg} onChange={e => update('weightKg', parseFloat(e.target.value) || 0)} style={inputStyle}
        onFocus={e => (e.target.style.borderColor = '#f97316')} onBlur={e => (e.target.style.borderColor = '#e2e8f0')} />
    </div>,

    <div key="3">
      <h2 style={{ fontSize: 22, fontWeight: 700, color: '#1e293b', marginBottom: 24 }}>Activity Level</h2>
      <div className="flex flex-col gap-2">
        {ACTIVITY_LEVELS.map(a => (
          <button key={a.value} onClick={() => update('activityLevel', a.value)} style={{
            padding: '14px 16px', borderRadius: 14, textAlign: 'left', cursor: 'pointer',
            border: profile.activityLevel === a.value ? '2px solid #f97316' : '2px solid #e2e8f0',
            backgroundColor: profile.activityLevel === a.value ? '#fff7ed' : '#fff',
          }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: profile.activityLevel === a.value ? '#f97316' : '#1e293b' }}>{a.label}</div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{a.desc}</div>
          </button>
        ))}
      </div>
    </div>,

    <div key="4">
      <h2 style={{ fontSize: 22, fontWeight: 700, color: '#1e293b', marginBottom: 24 }}>Your Goal</h2>
      <div className="flex flex-col gap-2 mb-6">
        {WEEKLY_GOALS.map(g => (
          <button key={g.value} onClick={() => update('weeklyGoalOffset', g.value)} style={{
            padding: '14px 16px', borderRadius: 14, textAlign: 'left', cursor: 'pointer', fontSize: 15, fontWeight: 600,
            border: profile.weeklyGoalOffset === g.value ? '2px solid #f97316' : '2px solid #e2e8f0',
            backgroundColor: profile.weeklyGoalOffset === g.value ? '#fff7ed' : '#fff',
            color: profile.weeklyGoalOffset === g.value ? '#f97316' : '#1e293b',
          }}>{g.label}</button>
        ))}
      </div>
      <div style={{ padding: 20, borderRadius: 16, background: 'linear-gradient(135deg, #fff7ed, #fef3c7)', textAlign: 'center' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#92400e', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Your daily target</div>
        <div style={{ fontSize: 48, fontWeight: 800, color: '#f97316' }}>{target}</div>
        <div style={{ fontSize: 14, color: '#92400e' }}>calories per day</div>
        <div style={{ fontSize: 12, color: '#b45309', marginTop: 8 }}>TDEE: {tdee} kcal | Deficit: {Math.abs(profile.weeklyGoalOffset)} kcal</div>
      </div>
    </div>,
  ];

  const canNext = step === 0 ? profile.name.trim() : true;

  const handleFinish = async () => {
    const finalProfile = { ...profile, calorieTarget: target, tdee };
    await save('profile', finalProfile);
    await save('weight-history', [{ date: dateKey(), weight: profile.weightKg }]);
    onComplete(finalProfile);
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 24, maxWidth: 480, margin: '0 auto' }}>
      <div className="flex gap-2 justify-center mb-4 pt-4">
        {steps.map((_, i) => (
          <div key={i} style={{
            width: i === step ? 24 : 8, height: 8, borderRadius: 4,
            backgroundColor: i <= step ? '#f97316' : '#e2e8f0', transition: 'all 0.3s ease',
          }} />
        ))}
      </div>
      <div style={{ flex: 1 }}>{steps[step]}</div>
      <div className="flex gap-3 pb-4 mt-8">
        {step > 0 && (
          <button onClick={() => setStep(s => s - 1)} style={{
            flex: 1, padding: 16, borderRadius: 14, fontSize: 15, fontWeight: 600,
            border: '2px solid #e2e8f0', backgroundColor: '#fff', color: '#64748b', cursor: 'pointer',
          }}>Back</button>
        )}
        <button onClick={() => (step < steps.length - 1 ? setStep(s => s + 1) : handleFinish())} disabled={!canNext} style={{
          flex: 2, padding: 16, borderRadius: 14, fontSize: 16, fontWeight: 700, border: 'none', color: '#fff', cursor: canNext ? 'pointer' : 'default',
          backgroundColor: canNext ? '#f97316' : '#d1d5db', boxShadow: canNext ? '0 4px 14px rgba(249,115,22,0.3)' : 'none',
        }}>{step < steps.length - 1 ? 'Continue' : 'Start Tracking'}</button>
      </div>
    </div>
  );
}

/* ─── Main App ───────────────────────────────────────────────────────────── */

export default function App() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [screen, setScreen] = useState('dashboard');
  const [selectedDate, setSelectedDate] = useState(dateKey());
  const [dayLog, setDayLog] = useState({ breakfast: [], lunch: [], dinner: [], snacks: [] });
  const [weightHistory, setWeightHistory] = useState([]);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchMeal, setSearchMeal] = useState('breakfast');
  const [portionFood, setPortionFood] = useState(null);
  const [quickAddMeal, setQuickAddMeal] = useState(null);
  const searchTimer = useRef(null);
  const searchAbort = useRef(null);
  const searchCache = useRef({});
  const [recentFoods, setRecentFoods] = useState([]);

  const [newWeight, setNewWeight] = useState('');
  const [editingProfile, setEditingProfile] = useState(null);

  // ── Load initial data ──
  useEffect(() => {
    (async () => {
      try {
        const uid = await waitForAuth();
        setUid(uid);
        const p = await load('profile', null);
        if (p) {
          setProfile(p);
          setWeightHistory(await load('weight-history', []));
          setRecentFoods(await load('recent-foods', []));
        }
      } catch (e) {
        console.error('Init error:', e);
      }
      setLoading(false);
    })();
  }, []);

  // ── Load day log when date changes ──
  useEffect(() => {
    if (!profile) return;
    (async () => {
      setDayLog(await load(`log-${selectedDate}`, { breakfast: [], lunch: [], dinner: [], snacks: [] }));
    })();
  }, [selectedDate, profile]);

  // ── Save helpers ──
  const saveDayLog = async (newLog) => {
    setDayLog(newLog);
    await save(`log-${selectedDate}`, newLog);
  };

  const addFoodEntry = async (entry) => {
    const newLog = { ...dayLog, [entry.meal]: [...dayLog[entry.meal], entry] };
    await saveDayLog(newLog);
    if (entry.brand !== 'Quick add' && entry.caloriesPer100) {
      const { id, name, brand, caloriesPer100, proteinPer100, carbsPer100, fatPer100 } = entry;
      const foodRecord = { id, name, brand, caloriesPer100, proteinPer100, carbsPer100, fatPer100 };
      const updated = [foodRecord, ...recentFoods.filter(f => f.id !== id)].slice(0, 20);
      setRecentFoods(updated);
      await save('recent-foods', updated);
    }
    setPortionFood(null);
    setSearchQuery('');
    setSearchResults([]);
    setScreen('log');
  };

  const removeFoodEntry = async (meal, index) => {
    await saveDayLog({ ...dayLog, [meal]: dayLog[meal].filter((_, i) => i !== index) });
  };

  // ── Food search via Open Food Facts ──
  const searchFood = useCallback(async (query) => {
    if (!query.trim() || query.length < 2) { setSearchResults([]); return; }

    // Return cached result instantly
    if (searchCache.current[query]) {
      setSearchResults(searchCache.current[query]);
      return;
    }

    // Cancel any in-flight request
    if (searchAbort.current) searchAbort.current.abort();
    const controller = new AbortController();
    searchAbort.current = controller;

    setSearching(true);
    try {
      const res = await fetch(
        `https://uk.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&json=1&page_size=20&fields=code,product_name,brands,nutriments,image_small_url`,
        { signal: controller.signal }
      );
      const data = await res.json();
      const results = (data.products || []).filter(
        p => p.product_name && p.nutriments && (p.nutriments['energy-kcal_100g'] || p.nutriments['energy-kcal'])
      );
      searchCache.current[query] = results;
      setSearchResults(results);
    } catch (e) {
      if (e.name !== 'AbortError') setSearchResults([]);
    }
    setSearching(false);
  }, []);

  const handleSearchInput = (val) => {
    setSearchQuery(val);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => searchFood(val), 300);
  };

  // ── Calculations ──
  const totals = MEALS.reduce((acc, meal) => {
    dayLog[meal].forEach(e => { acc.calories += e.calories || 0; acc.protein += e.protein || 0; acc.carbs += e.carbs || 0; acc.fat += e.fat || 0; });
    return acc;
  }, { calories: 0, protein: 0, carbs: 0, fat: 0 });

  const target = profile?.calorieTarget || 2000;
  const proteinTarget = Math.round((target * 0.30) / 4);
  const carbsTarget = Math.round((target * 0.40) / 4);
  const fatTarget = Math.round((target * 0.30) / 9);

  // ── Date nav ──
  const changeDate = (offset) => {
    const d = new Date(selectedDate + 'T12:00:00');
    d.setDate(d.getDate() + offset);
    setSelectedDate(dateKey(d));
  };
  const isToday = selectedDate === dateKey();

  // ── Weight ──
  const logWeight = async () => {
    const w = parseFloat(newWeight);
    if (!w) return;
    const today = dateKey();
    const updated = weightHistory.filter(e => e.date !== today);
    updated.push({ date: today, weight: w });
    updated.sort((a, b) => a.date.localeCompare(b.date));
    setWeightHistory(updated);
    await save('weight-history', updated);
    setNewWeight('');
  };

  // ── Profile update ──
  const saveProfileUpdate = async () => {
    if (!editingProfile) return;
    const tdee = calcTDEE(editingProfile);
    const updated = { ...editingProfile, tdee, calorieTarget: tdee + editingProfile.weeklyGoalOffset };
    setProfile(updated);
    await save('profile', updated);
    setEditingProfile(null);
  };

  const resetAllData = async () => {
    if (!confirm('This will delete ALL your data. Are you sure?')) return;
    await clearAll();
    setProfile(null);
    setDayLog({ breakfast: [], lunch: [], dinner: [], snacks: [] });
    setWeightHistory([]);
    setScreen('dashboard');
  };

  // ── Loading state ──
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fafaf9' }}>
        <div style={{ fontSize: 40, animation: 'pulse 1.5s infinite' }}>🔥</div>
      </div>
    );
  }

  if (!profile) return <Onboarding onComplete={p => { setProfile(p); setScreen('dashboard'); }} />;

  const navItems = [
    { id: 'dashboard', icon: '◉', label: 'Today' },
    { id: 'log', icon: '☰', label: 'Log' },
    { id: 'search', icon: '＋', label: 'Add' },
    { id: 'weight', icon: '⚖', label: 'Weight' },
    { id: 'settings', icon: '⚙', label: 'Settings' },
  ];

  return (
    <div style={{ backgroundColor: '#fafaf9', minHeight: '100vh', paddingBottom: 80 }}>

      {/* ── Header ── */}
      <div style={{ padding: '16px 20px 12px', backgroundColor: '#fff', borderBottom: '1px solid rgba(0,0,0,0.05)', position: 'sticky', top: 0, zIndex: 100 }}>
        <div className="flex items-center justify-between" style={{ maxWidth: 480, margin: '0 auto' }}>
          {['dashboard', 'log', 'search'].includes(screen) ? (
            <button onClick={() => changeDate(-1)} style={{
              width: 36, height: 36, borderRadius: 10, border: '1.5px solid #e2e8f0', backgroundColor: '#fff',
              cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b',
            }}>←</button>
          ) : <div style={{ width: 36 }} />}
          <div className="text-center">
            {['dashboard', 'log', 'search'].includes(screen) ? (
              <>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#1e293b' }}>{isToday ? 'Today' : formatDate(selectedDate)}</div>
                {!isToday && <div style={{ fontSize: 11, color: '#94a3b8' }}>{selectedDate}</div>}
              </>
            ) : (
              <div style={{ fontSize: 16, fontWeight: 700, color: '#1e293b' }}>
                {screen === 'weight' ? 'Weight' : screen === 'settings' ? 'Settings' : screen}
              </div>
            )}
          </div>
          {['dashboard', 'log', 'search'].includes(screen) ? (
          <button onClick={() => changeDate(1)} disabled={isToday} style={{
            width: 36, height: 36, borderRadius: 10, border: '1.5px solid #e2e8f0', backgroundColor: '#fff',
            cursor: isToday ? 'default' : 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: isToday ? '#d1d5db' : '#64748b', opacity: isToday ? 0.5 : 1,
          }}>→</button>
          ) : <div style={{ width: 36 }} />}
        </div>
      </div>

      <div style={{ maxWidth: 480, margin: '0 auto', padding: '0 16px' }}>

        {/* ═══ DASHBOARD ═══ */}
        {screen === 'dashboard' && (
          <div className="slide-up">
            <div style={{ padding: '20px 0 8px' }}>
              <div style={{ fontSize: 14, color: '#94a3b8', fontWeight: 500 }}>
                {new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening'}, {profile.name} 👋
              </div>
            </div>

            <div style={{ backgroundColor: '#fff', borderRadius: 20, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', marginBottom: 16 }}>
              <div className="flex items-center justify-center" style={{ marginBottom: 20 }}>
                <CalorieRing consumed={Math.round(totals.calories)} target={target} />
              </div>
              <div className="flex justify-between" style={{ padding: '0 8px' }}>
                {[
                  { label: 'Consumed', val: Math.round(totals.calories), color: '#1e293b' },
                  { label: 'Target', val: target, color: '#f97316' },
                  { label: target - totals.calories < 0 ? 'Over' : 'Left', val: Math.abs(Math.round(target - totals.calories)), color: target - totals.calories < 0 ? '#ef4444' : '#10b981' },
                ].map(s => (
                  <div key={s.label} className="text-center">
                    <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.val}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{s.label}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ backgroundColor: '#fff', borderRadius: 20, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', marginBottom: 16 }}>
              <div className="flex gap-4">
                <MacroBar label="Protein" value={totals.protein} target={proteinTarget} color="#3b82f6" />
                <MacroBar label="Carbs" value={totals.carbs} target={carbsTarget} color="#8b5cf6" />
                <MacroBar label="Fat" value={totals.fat} target={fatTarget} color="#ef4444" />
              </div>
            </div>

            <div style={{ backgroundColor: '#fff', borderRadius: 20, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
              {MEALS.map(meal => {
                const mealCal = dayLog[meal].reduce((s, e) => s + (e.calories || 0), 0);
                return (
                  <div key={meal} onClick={() => { setSearchMeal(meal); setScreen('search'); }}
                    className="flex items-center justify-between"
                    style={{ padding: '12px 4px', cursor: 'pointer', borderBottom: meal !== 'snacks' ? '1px solid rgba(0,0,0,0.04)' : 'none' }}>
                    <div className="flex items-center gap-3">
                      <span style={{ fontSize: 22 }}>{MEAL_ICONS[meal]}</span>
                      <div>
                        <div style={{ fontSize: 15, fontWeight: 600, color: '#1e293b' }}>{MEAL_LABELS[meal]}</div>
                        <div style={{ fontSize: 12, color: '#94a3b8' }}>{dayLog[meal].length} item{dayLog[meal].length !== 1 ? 's' : ''}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span style={{ fontSize: 15, fontWeight: 700, color: mealCal > 0 ? '#1e293b' : '#d1d5db' }}>{mealCal} kcal</span>
                      <span style={{ color: '#d1d5db', fontSize: 18 }}>+</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ═══ FOOD LOG ═══ */}
        {screen === 'log' && (
          <div className="slide-up" style={{ paddingTop: 16 }}>
            {MEALS.map(meal => (
              <div key={meal} style={{ backgroundColor: '#fff', borderRadius: 20, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', marginBottom: 12 }}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span style={{ fontSize: 20 }}>{MEAL_ICONS[meal]}</span>
                    <span style={{ fontSize: 16, fontWeight: 700, color: '#1e293b' }}>{MEAL_LABELS[meal]}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span style={{ fontSize: 14, fontWeight: 700, color: '#f97316' }}>{dayLog[meal].reduce((s, e) => s + (e.calories || 0), 0)} kcal</span>
                    <button onClick={() => { setSearchMeal(meal); setScreen('search'); }} style={{
                      width: 28, height: 28, borderRadius: 8, border: '1.5px solid #e2e8f0', backgroundColor: '#fff',
                      cursor: 'pointer', fontSize: 15, color: '#f97316', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>+</button>
                  </div>
                </div>
                {dayLog[meal].length === 0 ? (
                  <div style={{ padding: '12px 0', fontSize: 13, color: '#cbd5e1', textAlign: 'center' }}>No entries yet — tap + to add food</div>
                ) : dayLog[meal].map((entry, idx) => (
                  <div key={idx} className="flex items-center justify-between" style={{ padding: '10px 0', borderTop: idx > 0 ? '1px solid rgba(0,0,0,0.04)' : 'none' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{entry.name}</div>
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>
                        {entry.grams ? `${entry.grams}g` : ''}{entry.brand && entry.brand !== 'Quick add' ? ` · ${entry.brand}` : ''} · P: {entry.protein}g · C: {entry.carbs}g · F: {entry.fat}g
                      </div>
                    </div>
                    <div className="flex items-center gap-2" style={{ flexShrink: 0, marginLeft: 8 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: '#1e293b' }}>{entry.calories}</span>
                      <button onClick={() => removeFoodEntry(meal, idx)} style={{
                        width: 24, height: 24, borderRadius: 6, border: 'none', backgroundColor: 'rgba(239,68,68,0.08)',
                        cursor: 'pointer', fontSize: 12, color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>✕</button>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* ═══ SEARCH ═══ */}
        {screen === 'search' && (
          <div className="slide-up" style={{ paddingTop: 16 }}>
            <div className="flex gap-2 mb-4 overflow-x-auto" style={{ paddingBottom: 4 }}>
              {MEALS.map(m => (
                <button key={m} onClick={() => setSearchMeal(m)} style={{
                  padding: '8px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                  border: searchMeal === m ? '2px solid #f97316' : '2px solid #e2e8f0',
                  backgroundColor: searchMeal === m ? '#fff7ed' : '#fff',
                  color: searchMeal === m ? '#f97316' : '#64748b',
                }}>{MEAL_ICONS[m]} {MEAL_LABELS[m]}</button>
              ))}
            </div>

            <div style={{ position: 'relative', marginBottom: 12 }}>
              <input value={searchQuery} onChange={e => handleSearchInput(e.target.value)}
                placeholder="Search foods (e.g. chicken breast, banana)..." autoFocus
                style={{
                  width: '100%', padding: '14px 16px 14px 42px', fontSize: 15, borderRadius: 14,
                  border: '2px solid #e2e8f0', outline: 'none', backgroundColor: '#fff', boxSizing: 'border-box',
                }}
                onFocus={e => (e.target.style.borderColor = '#f97316')} onBlur={e => (e.target.style.borderColor = '#e2e8f0')}
              />
              <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', fontSize: 18, color: '#94a3b8' }}>🔍</span>
            </div>

            <button onClick={() => setQuickAddMeal(searchMeal)} style={{
              width: '100%', padding: 12, borderRadius: 12, fontSize: 14, fontWeight: 600,
              border: '2px dashed #e2e8f0', backgroundColor: '#fff', color: '#64748b', cursor: 'pointer', marginBottom: 12,
            }}>✏️ Quick add — enter calories manually</button>

            <div style={{ backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
              {searching && <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>Searching Open Food Facts...</div>}
              {!searching && searchQuery.length >= 2 && searchResults.length === 0 && (
                <div style={{ padding: 20, textAlign: 'center' }}>
                  <div style={{ fontSize: 13, color: '#94a3b8' }}>No results for "{searchQuery}"</div>
                  <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 4 }}>Try a different term or use Quick Add</div>
                </div>
              )}
              {!searching && searchQuery.length < 2 && (
                recentFoods.length > 0 ? (
                  <>
                    <div style={{ padding: '12px 16px 4px', fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.8 }}>Recent</div>
                    {recentFoods.map((food, i) => (
                      <FoodItem key={food.id || i} product={{
                        code: food.id,
                        product_name: food.name,
                        brands: food.brand,
                        nutriments: {
                          'energy-kcal_100g': food.caloriesPer100,
                          proteins_100g: food.proteinPer100,
                          carbohydrates_100g: food.carbsPer100,
                          fat_100g: food.fatPer100,
                        },
                      }} onAdd={f => setPortionFood(f)} />
                    ))}
                  </>
                ) : (
                  <div style={{ padding: 20, textAlign: 'center' }}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>🥗</div>
                    <div style={{ fontSize: 14, color: '#94a3b8' }}>Search the Open Food Facts database</div>
                    <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 4 }}>Over 4 million UK products</div>
                  </div>
                )
              )}
              {searchResults.map((p, i) => (
                <FoodItem key={p.code || i} product={p} onAdd={food => setPortionFood(food)} />
              ))}
            </div>
          </div>
        )}

        {/* ═══ WEIGHT ═══ */}
        {screen === 'weight' && (
          <div className="slide-up" style={{ paddingTop: 16 }}>
            <div style={{ backgroundColor: '#fff', borderRadius: 20, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', marginBottom: 16 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#1e293b', marginBottom: 12 }}>Log Today's Weight</div>
              <div className="flex gap-3">
                <input type="number" value={newWeight} onChange={e => setNewWeight(e.target.value)}
                  placeholder={`Current: ${weightHistory.length > 0 ? weightHistory[weightHistory.length - 1].weight : '—'} kg`}
                  style={{ flex: 1, padding: '12px 16px', fontSize: 18, fontWeight: 600, borderRadius: 12, border: '2px solid #e2e8f0', outline: 'none' }}
                  onFocus={e => (e.target.style.borderColor = '#f97316')} onBlur={e => (e.target.style.borderColor = '#e2e8f0')}
                  onKeyDown={e => e.key === 'Enter' && logWeight()}
                />
                <button onClick={logWeight} style={{
                  padding: '12px 24px', borderRadius: 12, fontSize: 15, fontWeight: 700, border: 'none',
                  backgroundColor: '#f97316', color: '#fff', cursor: 'pointer', boxShadow: '0 4px 14px rgba(249,115,22,0.3)',
                }}>Log</button>
              </div>
            </div>

            {weightHistory.length > 1 && (
              <div style={{ backgroundColor: '#fff', borderRadius: 20, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', marginBottom: 16 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#1e293b', marginBottom: 16 }}>Progress</div>
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={weightHistory.slice(-30)}>
                    <defs>
                      <linearGradient id="wGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f97316" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="date" tickFormatter={d => d.slice(5)} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <YAxis domain={['dataMin - 1', 'dataMax + 1']} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={35} />
                    <Tooltip
                      contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)', fontSize: 13 }}
                      formatter={(val) => [`${val} kg`, 'Weight']} labelFormatter={formatDate}
                    />
                    <Area type="monotone" dataKey="weight" stroke="#f97316" strokeWidth={2.5} fill="url(#wGrad)" dot={{ r: 3, fill: '#f97316' }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}

            {weightHistory.length > 0 && (
              <div style={{ backgroundColor: '#fff', borderRadius: 20, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', marginBottom: 16 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#1e293b', marginBottom: 16 }}>Stats</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {[
                    { label: 'Starting', value: `${weightHistory[0].weight} kg`, color: '#64748b' },
                    { label: 'Current', value: `${weightHistory[weightHistory.length - 1].weight} kg`, color: '#1e293b' },
                    { label: 'Change', value: `${(weightHistory[weightHistory.length - 1].weight - weightHistory[0].weight).toFixed(1)} kg`, color: weightHistory[weightHistory.length - 1].weight <= weightHistory[0].weight ? '#10b981' : '#ef4444' },
                    { label: 'Entries', value: weightHistory.length, color: '#64748b' },
                  ].map(s => (
                    <div key={s.label} style={{ padding: 14, backgroundColor: '#f8fafc', borderRadius: 14 }}>
                      <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{s.label}</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ backgroundColor: '#fff', borderRadius: 20, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#1e293b', marginBottom: 12 }}>History</div>
              {[...weightHistory].reverse().slice(0, 14).map((e, i) => (
                <div key={e.date} className="flex justify-between items-center" style={{
                  padding: '10px 0', borderBottom: i < Math.min(weightHistory.length, 14) - 1 ? '1px solid rgba(0,0,0,0.04)' : 'none',
                }}>
                  <span style={{ fontSize: 14, color: '#64748b' }}>{formatDate(e.date)}</span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: '#1e293b' }}>{e.weight} kg</span>
                </div>
              ))}
              {weightHistory.length === 0 && <div style={{ padding: 12, textAlign: 'center', color: '#cbd5e1', fontSize: 13 }}>No entries yet</div>}
            </div>
          </div>
        )}

        {/* ═══ SETTINGS ═══ */}
        {screen === 'settings' && (
          <div className="slide-up" style={{ paddingTop: 16 }}>
            <div style={{ backgroundColor: '#fff', borderRadius: 20, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', marginBottom: 16 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#1e293b', marginBottom: 16 }}>Profile</div>
              <div className="flex flex-col gap-3">
                {[
                  { label: 'Name', value: profile.name },
                  { label: 'Gender', value: profile.gender },
                  { label: 'Age', value: profile.age },
                  { label: 'Height', value: `${profile.heightCm} cm` },
                  { label: 'Weight', value: `${profile.weightKg} kg` },
                  { label: 'Activity', value: ACTIVITY_LEVELS.find(a => a.value === profile.activityLevel)?.label },
                  { label: 'Goal', value: WEEKLY_GOALS.find(g => g.value === profile.weeklyGoalOffset)?.label },
                ].map(row => (
                  <div key={row.label} className="flex justify-between" style={{ fontSize: 14 }}>
                    <span style={{ color: '#94a3b8', fontWeight: 500 }}>{row.label}</span>
                    <span style={{ color: '#1e293b', fontWeight: 600 }}>{row.value}</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ backgroundColor: '#fff', borderRadius: 20, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', marginBottom: 16 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#1e293b', marginBottom: 16 }}>Daily Targets</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, padding: 16, backgroundColor: '#f8fafc', borderRadius: 14 }}>
                {[
                  { label: 'Calories', val: target, color: '#f97316' },
                  { label: 'Protein', val: proteinTarget, color: '#3b82f6' },
                  { label: 'Carbs', val: carbsTarget, color: '#8b5cf6' },
                  { label: 'Fat', val: fatTarget, color: '#ef4444' },
                ].map(m => (
                  <div key={m.label} className="text-center">
                    <div style={{ fontSize: 22, fontWeight: 700, color: m.color }}>{m.val}</div>
                    <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{m.label}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 8, textAlign: 'center' }}>TDEE: {profile.tdee} kcal | Macro split: 30P / 40C / 30F</div>
            </div>

            {!editingProfile ? (
              <button onClick={() => setEditingProfile({ ...profile })} style={{
                width: '100%', padding: 14, borderRadius: 14, fontSize: 15, fontWeight: 600,
                border: '2px solid #e2e8f0', backgroundColor: '#fff', color: '#1e293b', cursor: 'pointer', marginBottom: 12,
              }}>Edit Profile</button>
            ) : (
              <div style={{ backgroundColor: '#fff', borderRadius: 20, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', marginBottom: 16 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#1e293b', marginBottom: 16 }}>Edit Profile</div>
                <div className="flex flex-col gap-3">
                  {[
                    { key: 'name', label: 'Name', type: 'text' },
                    { key: 'age', label: 'Age', type: 'number' },
                    { key: 'heightCm', label: 'Height (cm)', type: 'number' },
                    { key: 'weightKg', label: 'Weight (kg)', type: 'number' },
                  ].map(f => (
                    <div key={f.key}>
                      <label style={{ fontSize: 12, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>{f.label}</label>
                      <input type={f.type} value={editingProfile[f.key]}
                        onChange={e => setEditingProfile(p => ({ ...p, [f.key]: f.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value }))}
                        style={{ width: '100%', padding: '10px 14px', fontSize: 15, borderRadius: 12, border: '2px solid #e2e8f0', outline: 'none', boxSizing: 'border-box' }}
                        onFocus={e => (e.target.style.borderColor = '#f97316')} onBlur={e => (e.target.style.borderColor = '#e2e8f0')}
                      />
                    </div>
                  ))}
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>Activity Level</label>
                    <select value={editingProfile.activityLevel} onChange={e => setEditingProfile(p => ({ ...p, activityLevel: parseFloat(e.target.value) }))}
                      style={{ width: '100%', padding: '10px 14px', fontSize: 15, borderRadius: 12, border: '2px solid #e2e8f0', outline: 'none', backgroundColor: '#fff', boxSizing: 'border-box' }}>
                      {ACTIVITY_LEVELS.map(a => <option key={a.value} value={a.value}>{a.label} — {a.desc}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>Weekly Goal</label>
                    <select value={editingProfile.weeklyGoalOffset} onChange={e => setEditingProfile(p => ({ ...p, weeklyGoalOffset: parseInt(e.target.value) }))}
                      style={{ width: '100%', padding: '10px 14px', fontSize: 15, borderRadius: 12, border: '2px solid #e2e8f0', outline: 'none', backgroundColor: '#fff', boxSizing: 'border-box' }}>
                      {WEEKLY_GOALS.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
                    </select>
                  </div>
                </div>
                <div className="flex gap-3 mt-4">
                  <button onClick={() => setEditingProfile(null)} style={{ flex: 1, padding: 12, borderRadius: 12, fontSize: 14, fontWeight: 600, border: '2px solid #e2e8f0', backgroundColor: '#fff', color: '#64748b', cursor: 'pointer' }}>Cancel</button>
                  <button onClick={saveProfileUpdate} style={{ flex: 2, padding: 12, borderRadius: 12, fontSize: 14, fontWeight: 700, border: 'none', backgroundColor: '#f97316', color: '#fff', cursor: 'pointer' }}>Save Changes</button>
                </div>
              </div>
            )}

            <div style={{ backgroundColor: '#fff', borderRadius: 20, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', marginTop: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#ef4444', marginBottom: 8 }}>Danger Zone</div>
              <button onClick={resetAllData} style={{
                width: '100%', padding: 12, borderRadius: 12, fontSize: 14, fontWeight: 600,
                border: '2px solid #fecaca', backgroundColor: '#fef2f2', color: '#ef4444', cursor: 'pointer',
              }}>Reset All Data</button>
            </div>

            <div style={{ padding: '24px 0', textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: '#cbd5e1' }}>Calorie Tracker · Powered by Open Food Facts</div>
              <div style={{ fontSize: 11, color: '#e2e8f0', marginTop: 4 }}>Data synced via Firebase</div>
            </div>
          </div>
        )}
      </div>

      {/* ── Bottom Nav ── */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, backgroundColor: '#fff',
        borderTop: '1px solid rgba(0,0,0,0.06)', padding: '8px 0 env(safe-area-inset-bottom, 8px)', zIndex: 200,
      }}>
        <div className="flex justify-around" style={{ maxWidth: 480, margin: '0 auto' }}>
          {navItems.map(item => (
            <button key={item.id} onClick={() => setScreen(item.id)} style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
              padding: '6px 12px', border: 'none', backgroundColor: 'transparent', cursor: 'pointer', minWidth: 56,
            }}>
              <span style={{
                fontSize: item.id === 'search' ? 24 : 18,
                color: screen === item.id ? '#f97316' : '#94a3b8',
                ...(item.id === 'search' ? {
                  width: 42, height: 42, borderRadius: '50%', backgroundColor: '#f97316', color: '#fff', fontSize: 22,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: -16,
                  boxShadow: '0 4px 14px rgba(249,115,22,0.3)',
                } : {}),
              }}>{item.icon}</span>
              <span style={{
                fontSize: 10, fontWeight: 600, letterSpacing: 0.3,
                color: screen === item.id ? '#f97316' : '#94a3b8',
                ...(item.id === 'search' ? { marginTop: 2 } : {}),
              }}>{item.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Modals ── */}
      {portionFood && <PortionModal food={portionFood} meal={searchMeal} onConfirm={addFoodEntry} onClose={() => setPortionFood(null)} />}
      {quickAddMeal && <QuickAddModal meal={quickAddMeal} onConfirm={entry => { addFoodEntry(entry); setQuickAddMeal(null); }} onClose={() => setQuickAddMeal(null)} />}
    </div>
  );
}
