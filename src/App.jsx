import { useState, useEffect, useCallback, useRef } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
  BarChart, Bar, Cell, ComposedChart, Line,
  PieChart, Pie, RadarChart, Radar, PolarGrid, PolarAngleAxis,
} from 'recharts';
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

function FoodItem({ product, onAdd, onDelete }) {
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
        fibrePer100: n.fiber_100g || n['fiber_100g'] || 0,
        sugarPer100: n.sugars_100g || 0,
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
        <div className="flex items-center gap-2">
          <div style={{ fontSize: 14, fontWeight: 700, color: '#f97316' }}>{cal} kcal</div>
          {onDelete && <button onClick={e => { e.stopPropagation(); onDelete(); }} style={{ width: 20, height: 20, borderRadius: 5, border: 'none', backgroundColor: 'rgba(239,68,68,0.1)', color: '#ef4444', fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>}
        </div>
      </div>
      <div className="flex gap-3 mt-2" style={{ flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: '#64748b' }}>P: {Math.round(n.proteins_100g || 0)}g</span>
        <span style={{ fontSize: 11, color: '#64748b' }}>C: {Math.round(n.carbohydrates_100g || 0)}g</span>
        <span style={{ fontSize: 11, color: '#64748b' }}>F: {Math.round(n.fat_100g || 0)}g</span>
        {(n.fiber_100g || n['fiber_100g']) ? <span style={{ fontSize: 11, color: '#64748b' }}>Fi: {Math.round(n.fiber_100g || n['fiber_100g'] || 0)}g</span> : null}
        {n.sugars_100g ? <span style={{ fontSize: 11, color: '#64748b' }}>S: {Math.round(n.sugars_100g || 0)}g</span> : null}
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
    fibre: +((food.fibrePer100 || 0) * mult).toFixed(1),
    sugar: +((food.sugarPer100 || 0) * mult).toFixed(1),
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

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, padding: 16, backgroundColor: '#f8fafc', borderRadius: 14, marginBottom: 20 }}>
          {[
            { label: 'Calories', val: entry.calories, color: '#f97316' },
            { label: 'Protein', val: `${entry.protein}g`, color: '#3b82f6' },
            { label: 'Carbs', val: `${entry.carbs}g`, color: '#8b5cf6' },
            { label: 'Fat', val: `${entry.fat}g`, color: '#ef4444' },
            { label: 'Fibre', val: `${entry.fibre}g`, color: '#10b981' },
            { label: 'Sugar', val: `${entry.sugar}g`, color: '#f59e0b' },
          ].map(m => (
            <div key={m.label} className="text-center">
              <div style={{ fontSize: 18, fontWeight: 700, color: m.color }}>{m.val}</div>
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

/* ─── Install Prompt ─────────────────────────────────────────────────────── */

function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showIOSTip, setShowIOSTip] = useState(false);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem('pwa-dismissed') === '1');

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;

  useEffect(() => {
    if (isStandalone || dismissed) return;
    if (isIOS) { setShowIOSTip(true); return; }
    const handler = (e) => { e.preventDefault(); setDeferredPrompt(e); };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const dismiss = () => {
    localStorage.setItem('pwa-dismissed', '1');
    setDismissed(true);
    setDeferredPrompt(null);
    setShowIOSTip(false);
  };

  const install = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') dismiss();
    setDeferredPrompt(null);
  };

  if (isStandalone || dismissed || (!deferredPrompt && !showIOSTip)) return null;

  const bannerStyle = {
    position: 'fixed', bottom: 72, left: 0, right: 0, zIndex: 300,
    padding: '0 16px', maxWidth: 480, margin: '0 auto',
  };
  const boxStyle = {
    backgroundColor: '#1e293b', borderRadius: 16, padding: '14px 16px',
    boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
  };

  if (deferredPrompt) return (
    <div style={bannerStyle}>
      <div style={{ ...boxStyle, display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 24, flexShrink: 0 }}>📲</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>Add to Home Screen</div>
          <div style={{ fontSize: 11, color: '#94a3b8' }}>Install CalStack for a native app experience</div>
        </div>
        <button onClick={install} style={{ padding: '8px 14px', borderRadius: 10, fontSize: 13, fontWeight: 700, border: 'none', backgroundColor: '#f97316', color: '#fff', cursor: 'pointer' }}>Install</button>
        <button onClick={dismiss} style={{ border: 'none', backgroundColor: 'transparent', color: '#64748b', cursor: 'pointer', fontSize: 16, padding: 4 }}>✕</button>
      </div>
    </div>
  );

  return (
    <div style={bannerStyle}>
      <div style={boxStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>📲 Add to Home Screen</div>
          <button onClick={dismiss} style={{ border: 'none', backgroundColor: 'transparent', color: '#64748b', cursor: 'pointer', fontSize: 16 }}>✕</button>
        </div>
        <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.6 }}>
          In Safari, tap the <strong style={{ color: '#fff' }}>Share</strong> button (square with arrow), then tap <strong style={{ color: '#fff' }}>"Add to Home Screen"</strong>.
        </div>
      </div>
    </div>
  );
}

/* ─── Barcode Scanner ────────────────────────────────────────────────────── */

function BarcodeScanner({ onDetect, onClose }) {
  const videoRef = useRef(null);
  const animRef = useRef(null);
  const [error, setError] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const supported = typeof window !== 'undefined' && 'BarcodeDetector' in window;

  useEffect(() => {
    if (!supported) return;
    let stream;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      .then(s => {
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          videoRef.current.play();
          setScanning(true);
        }
      })
      .catch(() => setError('Camera access denied. Enter barcode manually below.'));
    return () => {
      if (stream) stream.getTracks().forEach(t => t.stop());
      cancelAnimationFrame(animRef.current);
    };
  }, [supported]);

  useEffect(() => {
    if (!scanning || !supported) return;
    const detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'] });
    let active = true;
    const detect = async () => {
      if (!active || !videoRef.current) return;
      try {
        const results = await detector.detect(videoRef.current);
        if (results.length > 0) { onDetect(results[0].rawValue); return; }
      } catch {}
      animRef.current = requestAnimationFrame(detect);
    };
    animRef.current = requestAnimationFrame(detect);
    return () => { active = false; cancelAnimationFrame(animRef.current); };
  }, [scanning, onDetect, supported]);

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', textAlign: 'center', marginBottom: 20 }}>Scan Barcode</div>
        {supported && !error && (
          <div style={{ position: 'relative', borderRadius: 16, overflow: 'hidden', marginBottom: 20, aspectRatio: '4/3', backgroundColor: '#000' }}>
            <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <div style={{ width: '70%', height: 2, backgroundColor: '#f97316', boxShadow: '0 0 8px #f97316', borderRadius: 1 }} />
            </div>
          </div>
        )}
        {(error || !supported) && (
          <div style={{ padding: 16, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 12, marginBottom: 16, fontSize: 13, color: '#cbd5e1', textAlign: 'center' }}>
            {error || 'Barcode scanning not supported in this browser.'}
          </div>
        )}
        <div style={{ fontSize: 13, color: '#94a3b8', textAlign: 'center', marginBottom: 8 }}>Or enter barcode manually</div>
        <div className="flex gap-2">
          <input value={manualCode} onChange={e => setManualCode(e.target.value)} placeholder="e.g. 5000112548167"
            onKeyDown={e => e.key === 'Enter' && manualCode.trim() && onDetect(manualCode.trim())}
            style={{ flex: 1, padding: '12px 14px', fontSize: 15, borderRadius: 12, border: 'none', outline: 'none' }} />
          <button onClick={() => manualCode.trim() && onDetect(manualCode.trim())}
            style={{ padding: '12px 16px', borderRadius: 12, fontSize: 14, fontWeight: 700, border: 'none', backgroundColor: '#f97316', color: '#fff', cursor: 'pointer' }}>Go</button>
        </div>
        <button onClick={onClose} style={{ width: '100%', marginTop: 12, padding: 14, borderRadius: 12, fontSize: 15, fontWeight: 600, border: '2px solid rgba(255,255,255,0.2)', backgroundColor: 'transparent', color: '#94a3b8', cursor: 'pointer' }}>Cancel</button>
      </div>
    </div>
  );
}

/* ─── Exercise Modal ─────────────────────────────────────────────────────── */

function ExerciseModal({ onConfirm, onClose }) {
  const [name, setName] = useState('');
  const [kcal, setKcal] = useState('');
  const [duration, setDuration] = useState('');

  const presets = [
    { name: 'Walking (30 min)', kcal: 120 }, { name: 'Running (30 min)', kcal: 300 },
    { name: 'Cycling (30 min)', kcal: 250 }, { name: 'Swimming (30 min)', kcal: 220 },
    { name: 'Weight training (45 min)', kcal: 200 }, { name: 'HIIT (20 min)', kcal: 250 },
  ];

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000, padding: 16 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, backgroundColor: '#fff', borderRadius: 20, padding: 24, boxShadow: '0 -8px 40px rgba(0,0,0,0.15)', maxHeight: '80vh', overflowY: 'auto' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#1e293b', marginBottom: 16 }}>Log Exercise</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
          {presets.map(p => (
            <button key={p.name} onClick={() => { setName(p.name); setKcal(String(p.kcal)); }}
              style={{ padding: '10px 12px', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer', textAlign: 'left',
                border: name === p.name ? '2px solid #10b981' : '2px solid #e2e8f0',
                backgroundColor: name === p.name ? '#f0fdf4' : '#f8fafc', color: name === p.name ? '#059669' : '#64748b' }}>
              {p.name}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-3 mb-5">
          {[
            { placeholder: 'Exercise name *', value: name, set: setName, type: 'text' },
            { placeholder: 'Calories burned *', value: kcal, set: setKcal, type: 'number' },
            { placeholder: 'Duration (mins, optional)', value: duration, set: setDuration, type: 'number' },
          ].map((f, i) => (
            <input key={i} type={f.type} placeholder={f.placeholder} value={f.value} onChange={e => f.set(e.target.value)}
              style={{ width: '100%', padding: '10px 14px', fontSize: 15, borderRadius: 12, border: '2px solid #e2e8f0', outline: 'none', boxSizing: 'border-box' }}
              onFocus={e => (e.target.style.borderColor = '#10b981')} onBlur={e => (e.target.style.borderColor = '#e2e8f0')} />
          ))}
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} style={{ flex: 1, padding: 14, borderRadius: 14, fontSize: 15, fontWeight: 600, border: '2px solid #e2e8f0', backgroundColor: '#fff', color: '#64748b', cursor: 'pointer' }}>Cancel</button>
          <button onClick={() => name && kcal && onConfirm({ id: Date.now().toString(), name, kcal: parseInt(kcal) || 0, duration: parseInt(duration) || 0, timestamp: Date.now() })}
            style={{ flex: 2, padding: 14, borderRadius: 14, fontSize: 15, fontWeight: 700, border: 'none', backgroundColor: '#10b981', color: '#fff', cursor: 'pointer', opacity: (!name || !kcal) ? 0.5 : 1 }}>
            Log Exercise
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Custom Food Modal ──────────────────────────────────────────────────── */

function CustomFoodModal({ onSave, onClose }) {
  const [form, setForm] = useState({ name: '', brand: '', calories: '', protein: '', carbs: '', fat: '', fibre: '', sugar: '' });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const inputStyle = { width: '100%', padding: '10px 14px', fontSize: 14, borderRadius: 12, border: '2px solid #e2e8f0', outline: 'none', boxSizing: 'border-box' };
  const focus = e => (e.target.style.borderColor = '#f97316');
  const blur = e => (e.target.style.borderColor = '#e2e8f0');
  const valid = form.name.trim() && form.calories;

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000, padding: 16 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, backgroundColor: '#fff', borderRadius: 20, padding: 24, boxShadow: '0 -8px 40px rgba(0,0,0,0.15)', maxHeight: '85vh', overflowY: 'auto' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#1e293b', marginBottom: 4 }}>Create Custom Food</div>
        <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 16 }}>All values per 100g</div>
        <div className="flex flex-col gap-3 mb-5">
          {[
            { k: 'name', label: 'Food name *', type: 'text' },
            { k: 'brand', label: 'Brand (optional)', type: 'text' },
            { k: 'calories', label: 'Calories (kcal) *', type: 'number' },
            { k: 'protein', label: 'Protein (g)', type: 'number' },
            { k: 'carbs', label: 'Carbs (g)', type: 'number' },
            { k: 'fat', label: 'Fat (g)', type: 'number' },
            { k: 'fibre', label: 'Fibre (g)', type: 'number' },
            { k: 'sugar', label: 'Sugar (g)', type: 'number' },
          ].map(f => (
            <div key={f.k}>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>{f.label}</label>
              <input type={f.type} value={form[f.k]} onChange={e => set(f.k, e.target.value)} style={inputStyle} onFocus={focus} onBlur={blur} />
            </div>
          ))}
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} style={{ flex: 1, padding: 14, borderRadius: 14, fontSize: 15, fontWeight: 600, border: '2px solid #e2e8f0', backgroundColor: '#fff', color: '#64748b', cursor: 'pointer' }}>Cancel</button>
          <button onClick={() => valid && onSave({
            id: `custom-${Date.now()}`, name: form.name.trim(), brand: form.brand.trim(),
            caloriesPer100: parseFloat(form.calories) || 0, proteinPer100: parseFloat(form.protein) || 0,
            carbsPer100: parseFloat(form.carbs) || 0, fatPer100: parseFloat(form.fat) || 0,
            fibrePer100: parseFloat(form.fibre) || 0, sugarPer100: parseFloat(form.sugar) || 0,
            isCustom: true,
          })} style={{ flex: 2, padding: 14, borderRadius: 14, fontSize: 15, fontWeight: 700, border: 'none', backgroundColor: '#f97316', color: '#fff', cursor: 'pointer', opacity: valid ? 1 : 0.5 }}>
            Save Food
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Save Meal Modal ────────────────────────────────────────────────────── */

function SaveMealModal({ mealLabel, onSave, onClose }) {
  const [name, setName] = useState(mealLabel);
  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000, padding: 16 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, backgroundColor: '#fff', borderRadius: 20, padding: 24, boxShadow: '0 -8px 40px rgba(0,0,0,0.15)' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#1e293b', marginBottom: 16 }}>Save Meal Template</div>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Template name"
          style={{ width: '100%', padding: '12px 14px', fontSize: 15, borderRadius: 12, border: '2px solid #e2e8f0', outline: 'none', boxSizing: 'border-box', marginBottom: 16 }}
          onFocus={e => (e.target.style.borderColor = '#f97316')} onBlur={e => (e.target.style.borderColor = '#e2e8f0')} autoFocus />
        <div className="flex gap-3">
          <button onClick={onClose} style={{ flex: 1, padding: 14, borderRadius: 14, fontSize: 15, fontWeight: 600, border: '2px solid #e2e8f0', backgroundColor: '#fff', color: '#64748b', cursor: 'pointer' }}>Cancel</button>
          <button onClick={() => name.trim() && onSave(name.trim())} style={{ flex: 2, padding: 14, borderRadius: 14, fontSize: 15, fontWeight: 700, border: 'none', backgroundColor: '#f97316', color: '#fff', cursor: 'pointer', opacity: name.trim() ? 1 : 0.5 }}>Save</button>
        </div>
      </div>
    </div>
  );
}

/* ─── Saved Meals Modal ──────────────────────────────────────────────────── */

function SavedMealsModal({ savedMeals, onLoad, onDelete, onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000, padding: 16 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, backgroundColor: '#fff', borderRadius: 20, padding: 24, boxShadow: '0 -8px 40px rgba(0,0,0,0.15)', maxHeight: '70vh', overflowY: 'auto' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#1e293b', marginBottom: 16 }}>Load Meal Template</div>
        {savedMeals.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>No saved meals yet. Save a meal from the Log screen.</div>
        ) : savedMeals.map(meal => (
          <div key={meal.id} className="flex items-center justify-between" style={{ padding: '14px 0', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#1e293b' }}>{meal.name}</div>
              <div style={{ fontSize: 12, color: '#94a3b8' }}>{meal.items.length} items · {meal.items.reduce((s, e) => s + (e.calories || 0), 0)} kcal</div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => onLoad(meal)} style={{ padding: '8px 14px', borderRadius: 10, fontSize: 13, fontWeight: 700, border: 'none', backgroundColor: '#f97316', color: '#fff', cursor: 'pointer' }}>Load</button>
              <button onClick={() => onDelete(meal.id)} style={{ padding: '8px 10px', borderRadius: 10, fontSize: 13, border: 'none', backgroundColor: 'rgba(239,68,68,0.08)', color: '#ef4444', cursor: 'pointer' }}>✕</button>
            </div>
          </div>
        ))}
        <button onClick={onClose} style={{ width: '100%', marginTop: 16, padding: 14, borderRadius: 14, fontSize: 15, fontWeight: 600, border: '2px solid #e2e8f0', backgroundColor: '#fff', color: '#64748b', cursor: 'pointer' }}>Close</button>
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
  const [dayLog, setDayLog] = useState({ breakfast: [], lunch: [], dinner: [], snacks: [], water: 0, exercises: [] });
  const [weightHistory, setWeightHistory] = useState([]);
  const [calorieSummary, setCalorieSummary] = useState({});

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
  const [showScanner, setShowScanner] = useState(false);
  const [barcodeLoading, setBarcodeLoading] = useState(false);
  const [showExerciseModal, setShowExerciseModal] = useState(false);
  const [customFoods, setCustomFoods] = useState([]);
  const [showCustomFoodModal, setShowCustomFoodModal] = useState(false);
  const [savedMeals, setSavedMeals] = useState([]);
  const [saveMealTarget, setSaveMealTarget] = useState(null); // { meal, label }
  const [loadMealTarget, setLoadMealTarget] = useState(null); // meal key

  const [newWeight, setNewWeight] = useState('');
  const [statsTab, setStatsTab] = useState('weight');
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
          const [wh, rf, cs, cf, sm] = await Promise.all([
            load('weight-history', []),
            load('recent-foods', []),
            load('calorie-summary', {}),
            load('custom-foods', []),
            load('saved-meals', []),
          ]);
          setWeightHistory(wh);
          setRecentFoods(rf);
          setCalorieSummary(cs);
          setCustomFoods(cf);
          setSavedMeals(sm);
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
      setDayLog(await load(`log-${selectedDate}`, { breakfast: [], lunch: [], dinner: [], snacks: [], water: 0, exercises: [] }));
    })();
  }, [selectedDate, profile]);

  // ── Save helpers ──
  const saveDayLog = async (newLog) => {
    setDayLog(newLog);
    await save(`log-${selectedDate}`, newLog);
    // Keep summary up to date for history chart and weekly stats
    const dayTotals = MEALS.reduce((a, m) => {
      (newLog[m] || []).forEach(e => { a.cal += e.calories || 0; a.p += e.protein || 0; a.c += e.carbs || 0; a.f += e.fat || 0; });
      return a;
    }, { cal: 0, p: 0, c: 0, f: 0 });
    const updated = { ...calorieSummary, [selectedDate]: dayTotals };
    setCalorieSummary(updated);
    save('calorie-summary', updated);
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

  // ── Exercise ──
  const addExercise = async (entry) => {
    const newLog = { ...dayLog, exercises: [...(dayLog.exercises || []), entry] };
    await saveDayLog(newLog);
    setShowExerciseModal(false);
  };

  const removeExercise = async (index) => {
    await saveDayLog({ ...dayLog, exercises: (dayLog.exercises || []).filter((_, i) => i !== index) });
  };

  // ── Water ──
  const addWater = async (ml) => {
    const newLog = { ...dayLog, water: (dayLog.water || 0) + ml };
    await saveDayLog(newLog);
  };

  const resetWater = async () => {
    await saveDayLog({ ...dayLog, water: 0 });
  };

  // ── Copy from yesterday ──
  const copyFromYesterday = async (meal) => {
    const d = new Date(selectedDate + 'T12:00:00');
    d.setDate(d.getDate() - 1);
    const yesterday = dateKey(d);
    const yLog = await load(`log-${yesterday}`, null);
    if (!yLog || !yLog[meal] || yLog[meal].length === 0) return;
    const copied = yLog[meal].map(e => ({ ...e, timestamp: Date.now() }));
    await saveDayLog({ ...dayLog, [meal]: [...dayLog[meal], ...copied] });
  };

  // ── Barcode lookup ──
  const handleBarcode = async (code) => {
    setShowScanner(false);
    setBarcodeLoading(true);
    try {
      const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${code}.json`);
      const data = await res.json();
      if (data.status === 1 && data.product) {
        const p = data.product;
        const n = p.nutriments || {};
        const cal = Math.round(n['energy-kcal_100g'] || n['energy-kcal'] || 0);
        if (cal > 0) {
          setPortionFood({
            id: code,
            name: p.product_name || 'Unknown Product',
            brand: p.brands || '',
            caloriesPer100: cal,
            proteinPer100: n.proteins_100g || 0,
            carbsPer100: n.carbohydrates_100g || 0,
            fatPer100: n.fat_100g || 0,
            fibrePer100: n.fiber_100g || 0,
            sugarPer100: n.sugars_100g || 0,
          });
        } else {
          alert('Product found but has no calorie data.');
        }
      } else {
        alert('Product not found. Try searching manually.');
      }
    } catch {
      alert('Could not look up barcode. Check your connection.');
    }
    setBarcodeLoading(false);
  };

  // ── Custom Foods ──
  const saveCustomFood = async (food) => {
    const updated = [food, ...customFoods];
    setCustomFoods(updated);
    await save('custom-foods', updated);
    setShowCustomFoodModal(false);
    setPortionFood(food);
  };

  const deleteCustomFood = async (id) => {
    const updated = customFoods.filter(f => f.id !== id);
    setCustomFoods(updated);
    await save('custom-foods', updated);
  };

  // ── Saved Meals ──
  const saveMealTemplate = async (meal, name) => {
    const items = dayLog[meal] || [];
    if (items.length === 0) return;
    const template = { id: `meal-${Date.now()}`, name, meal, items };
    const updated = [template, ...savedMeals];
    setSavedMeals(updated);
    await save('saved-meals', updated);
    setSaveMealTarget(null);
  };

  const loadMealTemplate = async (template) => {
    const copied = template.items.map(e => ({ ...e, timestamp: Date.now(), meal: loadMealTarget }));
    await saveDayLog({ ...dayLog, [loadMealTarget]: [...dayLog[loadMealTarget], ...copied] });
    setLoadMealTarget(null);
  };

  const deleteMealTemplate = async (id) => {
    const updated = savedMeals.filter(m => m.id !== id);
    setSavedMeals(updated);
    await save('saved-meals', updated);
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
      const base = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&json=1&page_size=20&fields=code,product_name,brands,nutriments,image_small_url`;
      const filterValid = p => p.product_name && p.nutriments && (p.nutriments['energy-kcal_100g'] || p.nutriments['energy-kcal']);

      // Try UK-filtered first
      const ukRes = await fetch(`${base}&tagtype_0=countries&tag_contains_0=contains&tag_0=en:united-kingdom`, { signal: controller.signal });
      const ukData = await ukRes.json();
      let results = (ukData.products || []).filter(filterValid);

      // Fall back to global if UK returns nothing
      if (results.length === 0) {
        const worldRes = await fetch(base, { signal: controller.signal });
        const worldData = await worldRes.json();
        results = (worldData.products || []).filter(filterValid);
      }

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
    dayLog[meal].forEach(e => {
      acc.calories += e.calories || 0; acc.protein += e.protein || 0;
      acc.carbs += e.carbs || 0; acc.fat += e.fat || 0;
      acc.fibre += e.fibre || 0; acc.sugar += e.sugar || 0;
    });
    return acc;
  }, { calories: 0, protein: 0, carbs: 0, fat: 0, fibre: 0, sugar: 0 });

  // Handle both old (number) and new (object) calorie summary formats
  const getSummaryCal = (v) => typeof v === 'number' ? v : (v?.cal || 0);

  const burned = (dayLog.exercises || []).reduce((s, e) => s + (e.kcal || 0), 0);
  const netCalories = totals.calories - burned;
  const waterMl = dayLog.water || 0;
  const waterTarget = 2500;

  const target = profile?.calorieTarget || 2000;
  const proteinTarget = Math.round((target * 0.30) / 4);
  const carbsTarget = Math.round((target * 0.40) / 4);
  const fatTarget = Math.round((target * 0.30) / 9);

  // ── Streak ──
  const streak = (() => {
    let count = 0;
    const d = new Date();
    while (count < 365) {
      const k = dateKey(d);
      if (!calorieSummary[k] || getSummaryCal(calorieSummary[k]) === 0) break;
      count++;
      d.setDate(d.getDate() - 1);
    }
    return count;
  })();

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
    { id: 'weight', icon: '⚖', label: 'Stats' },
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
            <div style={{ padding: '20px 0 8px' }} className="flex items-center justify-between">
              <div style={{ fontSize: 14, color: '#94a3b8', fontWeight: 500 }}>
                {new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening'}, {profile.name} 👋
              </div>
              {streak > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 20, backgroundColor: '#fff7ed', border: '1.5px solid #fed7aa' }}>
                  <span style={{ fontSize: 14 }}>🔥</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#f97316' }}>{streak} day{streak !== 1 ? 's' : ''}</span>
                </div>
              )}
            </div>

            {/* Calorie ring + stats */}
            <div style={{ backgroundColor: '#fff', borderRadius: 20, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', marginBottom: 16 }}>
              <div className="flex items-center justify-center" style={{ marginBottom: 20 }}>
                <CalorieRing consumed={Math.round(netCalories)} target={target} />
              </div>
              <div className="flex justify-between" style={{ padding: '0 4px' }}>
                {[
                  { label: 'Food', val: Math.round(totals.calories), color: '#1e293b' },
                  { label: 'Burned', val: burned, color: '#10b981' },
                  { label: 'Target', val: target, color: '#f97316' },
                  { label: netCalories > target ? 'Over' : 'Left', val: Math.abs(Math.round(target - netCalories)), color: netCalories > target ? '#ef4444' : '#10b981' },
                ].map(s => (
                  <div key={s.label} className="text-center">
                    <div style={{ fontSize: 18, fontWeight: 700, color: s.color }}>{s.val}</div>
                    <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{s.label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Macros */}
            <div style={{ backgroundColor: '#fff', borderRadius: 20, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', marginBottom: 16 }}>
              <div className="flex gap-4">
                <MacroBar label="Protein" value={totals.protein} target={proteinTarget} color="#3b82f6" />
                <MacroBar label="Carbs" value={totals.carbs} target={carbsTarget} color="#8b5cf6" />
                <MacroBar label="Fat" value={totals.fat} target={fatTarget} color="#ef4444" />
              </div>
            </div>

            {/* Water tracker */}
            <div style={{ backgroundColor: '#fff', borderRadius: 20, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', marginBottom: 16 }}>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b' }}>💧 Water</div>
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>{waterMl} / {waterTarget} ml</div>
                </div>
                <button onClick={resetWater} style={{ fontSize: 11, color: '#cbd5e1', border: 'none', backgroundColor: 'transparent', cursor: 'pointer' }}>Reset</button>
              </div>
              <div style={{ height: 6, backgroundColor: 'rgba(0,0,0,0.06)', borderRadius: 3, overflow: 'hidden', marginBottom: 12 }}>
                <div style={{ height: '100%', width: `${Math.min((waterMl / waterTarget) * 100, 100)}%`, backgroundColor: '#3b82f6', borderRadius: 3, transition: 'width 0.4s ease' }} />
              </div>
              <div className="flex gap-2">
                {[150, 250, 330, 500].map(ml => (
                  <button key={ml} onClick={() => addWater(ml)} style={{
                    flex: 1, padding: '8px 4px', borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                    border: '2px solid #dbeafe', backgroundColor: '#eff6ff', color: '#3b82f6',
                  }}>+{ml}</button>
                ))}
              </div>
            </div>

            {/* Meal summary */}
            <div style={{ backgroundColor: '#fff', borderRadius: 20, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', marginBottom: 16 }}>
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

            {/* Calorie history chart */}
            {Object.keys(calorieSummary).length > 1 && (() => {
              const last30 = Array.from({ length: 30 }, (_, i) => {
                const d = new Date(); d.setDate(d.getDate() - (29 - i));
                const k = dateKey(d);
                return { date: k, calories: getSummaryCal(calorieSummary[k]) };
              }).filter(d => d.calories > 0);
              if (last30.length < 2) return null;
              return (
                <div style={{ backgroundColor: '#fff', borderRadius: 20, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', marginBottom: 16 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b', marginBottom: 16 }}>Calorie History (30 days)</div>
                  <ResponsiveContainer width="100%" height={180}>
                    <AreaChart data={last30}>
                      <defs>
                        <linearGradient id="cGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f97316" stopOpacity={0.15} />
                          <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="date" tickFormatter={d => d.slice(5)} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={35} domain={[0, 'dataMax + 200']} />
                      <Tooltip contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)', fontSize: 12 }}
                        formatter={v => [`${v} kcal`, 'Calories']} labelFormatter={formatDate} />
                      <ReferenceLine y={target} stroke="#f97316" strokeDasharray="4 4" strokeOpacity={0.5} />
                      <Area type="monotone" dataKey="calories" stroke="#f97316" strokeWidth={2} fill="url(#cGrad)" dot={{ r: 2, fill: '#f97316' }} />
                    </AreaChart>
                  </ResponsiveContainer>
                  <div style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center', marginTop: 4 }}>Dashed line = daily target</div>
                </div>
              );
            })()}
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
                    <button onClick={() => copyFromYesterday(meal)} title="Copy from yesterday" style={{
                      width: 28, height: 28, borderRadius: 8, border: '1.5px solid #e2e8f0', backgroundColor: '#fff',
                      cursor: 'pointer', fontSize: 13, color: '#94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>⟳</button>
                    <button onClick={() => setLoadMealTarget(meal)} title="Load saved meal" style={{
                      width: 28, height: 28, borderRadius: 8, border: '1.5px solid #e2e8f0', backgroundColor: '#fff',
                      cursor: 'pointer', fontSize: 13, color: '#8b5cf6', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>★</button>
                    {dayLog[meal].length > 0 && (
                      <button onClick={() => setSaveMealTarget({ meal, label: MEAL_LABELS[meal] })} title="Save as template" style={{
                        width: 28, height: 28, borderRadius: 8, border: '1.5px solid #e2e8f0', backgroundColor: '#fff',
                        cursor: 'pointer', fontSize: 11, color: '#94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>💾</button>
                    )}
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

            {/* Exercise section */}
            <div style={{ backgroundColor: '#fff', borderRadius: 20, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', marginBottom: 12 }}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span style={{ fontSize: 20 }}>🏃</span>
                  <span style={{ fontSize: 16, fontWeight: 700, color: '#1e293b' }}>Exercise</span>
                </div>
                <div className="flex items-center gap-2">
                  {burned > 0 && <span style={{ fontSize: 14, fontWeight: 700, color: '#10b981' }}>-{burned} kcal</span>}
                  <button onClick={() => setShowExerciseModal(true)} style={{
                    width: 28, height: 28, borderRadius: 8, border: '1.5px solid #e2e8f0', backgroundColor: '#fff',
                    cursor: 'pointer', fontSize: 15, color: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>+</button>
                </div>
              </div>
              {(dayLog.exercises || []).length === 0 ? (
                <div style={{ padding: '12px 0', fontSize: 13, color: '#cbd5e1', textAlign: 'center' }}>No exercise logged — tap + to add</div>
              ) : (dayLog.exercises || []).map((ex, idx) => (
                <div key={idx} className="flex items-center justify-between" style={{ padding: '10px 0', borderTop: idx > 0 ? '1px solid rgba(0,0,0,0.04)' : 'none' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#1e293b' }}>{ex.name}</div>
                    {ex.duration > 0 && <div style={{ fontSize: 11, color: '#94a3b8' }}>{ex.duration} mins</div>}
                  </div>
                  <div className="flex items-center gap-2" style={{ flexShrink: 0, marginLeft: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: '#10b981' }}>-{ex.kcal}</span>
                    <button onClick={() => removeExercise(idx)} style={{
                      width: 24, height: 24, borderRadius: 6, border: 'none', backgroundColor: 'rgba(239,68,68,0.08)',
                      cursor: 'pointer', fontSize: 12, color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>✕</button>
                  </div>
                </div>
              ))}
            </div>
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
                  width: '100%', padding: '14px 48px 14px 42px', fontSize: 15, borderRadius: 14,
                  border: '2px solid #e2e8f0', outline: 'none', backgroundColor: '#fff', boxSizing: 'border-box',
                }}
                onFocus={e => (e.target.style.borderColor = '#f97316')} onBlur={e => (e.target.style.borderColor = '#e2e8f0')}
              />
              <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', fontSize: 18, color: '#94a3b8' }}>🔍</span>
              <button onClick={() => setShowScanner(true)} style={{
                position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                width: 32, height: 32, borderRadius: 8, border: 'none', backgroundColor: '#f97316',
                cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
              }}>⬛</button>
            </div>

            {barcodeLoading && <div style={{ padding: 12, textAlign: 'center', fontSize: 13, color: '#94a3b8', marginBottom: 8 }}>Looking up barcode...</div>}

            <div className="flex gap-2 mb-3">
              <button onClick={() => setQuickAddMeal(searchMeal)} style={{ flex: 1, padding: 12, borderRadius: 12, fontSize: 13, fontWeight: 600, border: '2px dashed #e2e8f0', backgroundColor: '#fff', color: '#64748b', cursor: 'pointer' }}>✏️ Quick add</button>
              <button onClick={() => setShowScanner(true)} style={{ flex: 1, padding: 12, borderRadius: 12, fontSize: 13, fontWeight: 600, border: '2px dashed #e2e8f0', backgroundColor: '#fff', color: '#64748b', cursor: 'pointer' }}>⬛ Scan barcode</button>
              <button onClick={() => setShowCustomFoodModal(true)} style={{ flex: 1, padding: 12, borderRadius: 12, fontSize: 13, fontWeight: 600, border: '2px dashed #e2e8f0', backgroundColor: '#fff', color: '#64748b', cursor: 'pointer' }}>＋ Create food</button>
            </div>

            <div style={{ backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
              {searching && <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>Searching...</div>}
              {!searching && searchQuery.length >= 2 && searchResults.length === 0 && (
                <div style={{ padding: 20, textAlign: 'center' }}>
                  <div style={{ fontSize: 13, color: '#94a3b8' }}>No results for "{searchQuery}"</div>
                  <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 4 }}>Try a different term or create a custom food</div>
                </div>
              )}
              {!searching && searchQuery.length < 2 && (() => {
                const filteredCustom = customFoods;
                return (
                  <>
                    {filteredCustom.length > 0 && (
                      <>
                        <div style={{ padding: '12px 16px 4px', fontSize: 11, fontWeight: 700, color: '#8b5cf6', textTransform: 'uppercase', letterSpacing: 0.8 }}>My Foods</div>
                        {filteredCustom.map(food => (
                          <FoodItem key={food.id} product={{
                            code: food.id, product_name: food.name, brands: food.brand,
                            nutriments: { 'energy-kcal_100g': food.caloriesPer100, proteins_100g: food.proteinPer100, carbohydrates_100g: food.carbsPer100, fat_100g: food.fatPer100, fiber_100g: food.fibrePer100, sugars_100g: food.sugarPer100 },
                          }} onAdd={() => setPortionFood(food)} onDelete={() => deleteCustomFood(food.id)} />
                        ))}
                      </>
                    )}
                    {recentFoods.length > 0 && (
                      <>
                        <div style={{ padding: '12px 16px 4px', fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.8 }}>Recent</div>
                        {recentFoods.map((food, i) => (
                          <FoodItem key={food.id || i} product={{
                            code: food.id, product_name: food.name, brands: food.brand,
                            nutriments: { 'energy-kcal_100g': food.caloriesPer100, proteins_100g: food.proteinPer100, carbohydrates_100g: food.carbsPer100, fat_100g: food.fatPer100 },
                          }} onAdd={f => setPortionFood(f)} />
                        ))}
                      </>
                    )}
                    {filteredCustom.length === 0 && recentFoods.length === 0 && (
                      <div style={{ padding: 20, textAlign: 'center' }}>
                        <div style={{ fontSize: 32, marginBottom: 8 }}>🥗</div>
                        <div style={{ fontSize: 14, color: '#94a3b8' }}>Search the Open Food Facts database</div>
                        <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 4 }}>Over 4 million UK products</div>
                      </div>
                    )}
                  </>
                );
              })()}
              {/* Custom food matches in search results */}
              {searchQuery.length >= 2 && (() => {
                const q = searchQuery.toLowerCase();
                const matches = customFoods.filter(f => f.name.toLowerCase().includes(q) || (f.brand || '').toLowerCase().includes(q));
                return matches.length > 0 ? (
                  <>
                    <div style={{ padding: '12px 16px 4px', fontSize: 11, fontWeight: 700, color: '#8b5cf6', textTransform: 'uppercase', letterSpacing: 0.8 }}>My Foods</div>
                    {matches.map(food => (
                      <FoodItem key={food.id} product={{
                        code: food.id, product_name: food.name, brands: food.brand,
                        nutriments: { 'energy-kcal_100g': food.caloriesPer100, proteins_100g: food.proteinPer100, carbohydrates_100g: food.carbsPer100, fat_100g: food.fatPer100 },
                      }} onAdd={() => setPortionFood(food)} onDelete={() => deleteCustomFood(food.id)} />
                    ))}
                  </>
                ) : null;
              })()}
              {searchResults.map((p, i) => (
                <FoodItem key={p.code || i} product={p} onAdd={food => setPortionFood(food)} />
              ))}
            </div>
          </div>
        )}

        {/* ═══ STATS ═══ */}
        {screen === 'weight' && (
          <div className="slide-up" style={{ paddingTop: 16 }}>
            {/* Tab switcher */}
            <div className="flex gap-2 mb-4">
              {[{ id: 'weight', label: '⚖ Weight' }, { id: 'insights', label: '📊 Insights' }].map(t => (
                <button key={t.id} onClick={() => setStatsTab(t.id)} style={{
                  flex: 1, padding: '10px 0', borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: 'pointer',
                  border: statsTab === t.id ? '2px solid #f97316' : '2px solid #e2e8f0',
                  backgroundColor: statsTab === t.id ? '#fff7ed' : '#fff',
                  color: statsTab === t.id ? '#f97316' : '#64748b',
                }}>{t.label}</button>
              ))}
            </div>

            {statsTab === 'weight' && <>
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

            {/* Weekly Summary */}
            {(() => {
              const days = Array.from({ length: 7 }, (_, i) => {
                const d = new Date(); d.setDate(d.getDate() - i);
                const k = dateKey(d);
                const s = calorieSummary[k];
                return s ? { date: k, cal: getSummaryCal(s), p: s?.p || 0, c: s?.c || 0, f: s?.f || 0 } : null;
              }).filter(Boolean);
              if (days.length === 0) return null;
              const avgCal = Math.round(days.reduce((s, d) => s + d.cal, 0) / days.length);
              const avgP = Math.round(days.reduce((s, d) => s + d.p, 0) / days.length);
              const avgC = Math.round(days.reduce((s, d) => s + d.c, 0) / days.length);
              const avgF = Math.round(days.reduce((s, d) => s + d.f, 0) / days.length);
              const best = days.reduce((a, b) => Math.abs(a.cal - target) < Math.abs(b.cal - target) ? a : b);
              const worst = days.reduce((a, b) => Math.abs(a.cal - target) > Math.abs(b.cal - target) ? a : b);
              const wStart = weightHistory.filter(e => e.date >= days[days.length - 1]?.date);
              const weightChange = wStart.length >= 2 ? (wStart[wStart.length - 1].weight - wStart[0].weight).toFixed(1) : null;
              return (
                <div style={{ backgroundColor: '#fff', borderRadius: 20, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', marginTop: 16 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#1e293b', marginBottom: 16 }}>This Week</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                    {[
                      { label: 'Avg Calories', value: `${avgCal} kcal`, color: '#f97316' },
                      { label: 'Avg Protein', value: `${avgP}g`, color: '#3b82f6' },
                      { label: 'Avg Carbs', value: `${avgC}g`, color: '#8b5cf6' },
                      { label: 'Avg Fat', value: `${avgF}g`, color: '#ef4444' },
                      { label: 'Best Day', value: formatDate(best.date), color: '#10b981' },
                      { label: 'Most Over', value: formatDate(worst.date), color: worst.cal > target ? '#ef4444' : '#94a3b8' },
                      ...(weightChange !== null ? [{ label: 'Weight Change', value: `${weightChange > 0 ? '+' : ''}${weightChange} kg`, color: parseFloat(weightChange) <= 0 ? '#10b981' : '#ef4444' }] : []),
                      { label: 'Days Logged', value: `${days.length} / 7`, color: '#64748b' },
                    ].map(s => (
                      <div key={s.label} style={{ padding: 12, backgroundColor: '#f8fafc', borderRadius: 12 }}>
                        <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{s.label}</div>
                        <div style={{ fontSize: 17, fontWeight: 700, color: s.color }}>{s.value}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center' }}>Based on {days.length} logged day{days.length !== 1 ? 's' : ''} this week</div>
                </div>
              );
            })()}
            </>}

            {statsTab === 'insights' && (() => {
              const bmr = Math.round(target / (profile.activityLevel || 1.55) * ((profile.weeklyGoalOffset || 0) === 0 ? 1 : 1) + Math.abs(profile.weeklyGoalOffset || 0));
              const actualBmr = Math.round(profile.tdee / (profile.activityLevel || 1.55));
              const tooltipStyle = { borderRadius: 12, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)', fontSize: 12 };

              // Build 14-day dataset
              const last14 = Array.from({ length: 14 }, (_, i) => {
                const d = new Date(); d.setDate(d.getDate() - (13 - i));
                const k = dateKey(d);
                const s = calorieSummary[k];
                const cal = getSummaryCal(s);
                return {
                  date: k, label: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
                  cal, deficit: cal > 0 ? cal - target : null,
                  p: s?.p || 0, c: s?.c || 0, f: s?.f || 0,
                };
              });
              const logged14 = last14.filter(d => d.cal > 0);

              // 7-day rolling average
              const withRolling = last14.map((d, i) => {
                const window = last14.slice(Math.max(0, i - 6), i + 1).filter(x => x.cal > 0);
                return { ...d, rolling: window.length > 0 ? Math.round(window.reduce((s, x) => s + x.cal, 0) / window.length) : null };
              });

              // Day-of-week averages
              const dowMap = {};
              Object.entries(calorieSummary).forEach(([k, v]) => {
                const cal = getSummaryCal(v);
                if (!cal) return;
                const dow = new Date(k + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short' });
                if (!dowMap[dow]) dowMap[dow] = { total: 0, count: 0 };
                dowMap[dow].total += cal; dowMap[dow].count++;
              });
              const dowOrder = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
              const dowData = dowOrder.map(d => ({ day: d, avg: dowMap[d] ? Math.round(dowMap[d].total / dowMap[d].count) : 0 }));

              // Macro donut for today
              const todayKey = dateKey();
              const todayS = calorieSummary[todayKey];
              const tp = todayS?.p || totals.protein;
              const tc = todayS?.c || totals.carbs;
              const tf = todayS?.f || totals.fat;
              const macroKcal = { Protein: Math.round(tp * 4), Carbs: Math.round(tc * 4), Fat: Math.round(tf * 9) };
              const macroTotal = macroKcal.Protein + macroKcal.Carbs + macroKcal.Fat;
              const macroColors = { Protein: '#3b82f6', Carbs: '#8b5cf6', Fat: '#ef4444' };
              const pieData = Object.entries(macroKcal).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value }));

              return (
                <div>
                  {/* ── Chart 1: Calorie intake vs TDEE/BMR ── */}
                  {logged14.length >= 2 && (
                    <div style={{ backgroundColor: '#fff', borderRadius: 20, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', marginBottom: 16 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b', marginBottom: 4 }}>Calories vs Targets</div>
                      <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 16 }}>Daily intake with 7-day rolling average</div>
                      <ResponsiveContainer width="100%" height={200}>
                        <ComposedChart data={withRolling} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id="cBarGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#f97316" stopOpacity={0.7} />
                              <stop offset="100%" stopColor="#f97316" stopOpacity={0.2} />
                            </linearGradient>
                          </defs>
                          <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} interval={2} />
                          <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={35} domain={[0, 'dataMax + 300']} />
                          <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [`${v} kcal`, n]} labelFormatter={l => l} />
                          <ReferenceLine y={target} stroke="#f97316" strokeDasharray="4 3" strokeOpacity={0.6} label={{ value: 'Target', position: 'insideTopRight', fontSize: 9, fill: '#f97316' }} />
                          <ReferenceLine y={profile.tdee} stroke="#10b981" strokeDasharray="4 3" strokeOpacity={0.5} label={{ value: 'TDEE', position: 'insideTopRight', fontSize: 9, fill: '#10b981' }} />
                          <ReferenceLine y={actualBmr} stroke="#94a3b8" strokeDasharray="3 3" strokeOpacity={0.4} label={{ value: 'BMR', position: 'insideTopRight', fontSize: 9, fill: '#94a3b8' }} />
                          <Bar dataKey="cal" name="Calories" fill="url(#cBarGrad)" radius={[4, 4, 0, 0]} maxBarSize={24} />
                          <Line dataKey="rolling" name="7-day avg" stroke="#1e293b" strokeWidth={2} dot={false} connectNulls />
                        </ComposedChart>
                      </ResponsiveContainer>
                      <div className="flex gap-4 mt-3" style={{ justifyContent: 'center' }}>
                        {[{ color: '#f97316', label: `Target: ${target}` }, { color: '#10b981', label: `TDEE: ${profile.tdee}` }, { color: '#94a3b8', label: `BMR: ${actualBmr}` }].map(l => (
                          <div key={l.label} className="flex items-center gap-1">
                            <div style={{ width: 10, height: 2, backgroundColor: l.color, borderRadius: 1 }} />
                            <span style={{ fontSize: 10, color: '#94a3b8' }}>{l.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ── Chart 2: Deficit / Surplus ── */}
                  {logged14.length >= 2 && (
                    <div style={{ backgroundColor: '#fff', borderRadius: 20, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', marginBottom: 16 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b', marginBottom: 4 }}>Deficit / Surplus</div>
                      <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 16 }}>How far above or below your target each day</div>
                      <ResponsiveContainer width="100%" height={180}>
                        <BarChart data={last14.filter(d => d.deficit !== null)} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                          <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} interval={1} />
                          <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={40} />
                          <Tooltip contentStyle={tooltipStyle}
                            formatter={(v) => [`${v > 0 ? '+' : ''}${v} kcal`, v > 0 ? 'Surplus' : 'Deficit']} />
                          <ReferenceLine y={0} stroke="#e2e8f0" strokeWidth={1.5} />
                          <Bar dataKey="deficit" name="Difference" radius={[3, 3, 0, 0]} maxBarSize={24}>
                            {last14.filter(d => d.deficit !== null).map((d, i) => (
                              <Cell key={i} fill={d.deficit <= 0 ? '#10b981' : d.deficit > 300 ? '#ef4444' : '#f59e0b'} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                      <div className="flex gap-4 mt-2" style={{ justifyContent: 'center' }}>
                        {[{ color: '#10b981', label: 'Deficit (good)' }, { color: '#f59e0b', label: 'Slight surplus' }, { color: '#ef4444', label: 'Large surplus' }].map(l => (
                          <div key={l.label} className="flex items-center gap-1">
                            <div style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: l.color }} />
                            <span style={{ fontSize: 10, color: '#94a3b8' }}>{l.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ── Chart 3: Today's Macro Split ── */}
                  {macroTotal > 0 && (
                    <div style={{ backgroundColor: '#fff', borderRadius: 20, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', marginBottom: 16 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b', marginBottom: 4 }}>Today's Macro Split</div>
                      <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>Calorie contribution by macronutrient</div>
                      <div className="flex items-center gap-4">
                        <PieChart width={140} height={140}>
                          <Pie data={pieData} cx={65} cy={65} innerRadius={42} outerRadius={62} paddingAngle={3} dataKey="value" strokeWidth={0}>
                            {pieData.map((entry) => <Cell key={entry.name} fill={macroColors[entry.name]} />)}
                          </Pie>
                          <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [`${v} kcal (${Math.round(v / macroTotal * 100)}%)`, n]} />
                        </PieChart>
                        <div className="flex flex-col gap-3" style={{ flex: 1 }}>
                          {Object.entries(macroKcal).map(([name, kcal]) => (
                            <div key={name}>
                              <div className="flex justify-between" style={{ marginBottom: 3 }}>
                                <span style={{ fontSize: 12, fontWeight: 600, color: macroColors[name] }}>{name}</span>
                                <span style={{ fontSize: 11, color: '#94a3b8' }}>{kcal} kcal · {macroTotal > 0 ? Math.round(kcal / macroTotal * 100) : 0}%</span>
                              </div>
                              <div style={{ height: 5, backgroundColor: 'rgba(0,0,0,0.06)', borderRadius: 3, overflow: 'hidden' }}>
                                <div style={{ height: '100%', width: `${macroTotal > 0 ? (kcal / macroTotal) * 100 : 0}%`, backgroundColor: macroColors[name], borderRadius: 3 }} />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ── Chart 4: Macro Trend (Stacked Area) ── */}
                  {logged14.length >= 3 && (
                    <div style={{ backgroundColor: '#fff', borderRadius: 20, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', marginBottom: 16 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b', marginBottom: 4 }}>Macro Trend</div>
                      <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 16 }}>Daily grams of protein, carbs and fat</div>
                      <ResponsiveContainer width="100%" height={180}>
                        <AreaChart data={logged14} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                          <defs>
                            {[['pGrad', '#3b82f6'], ['cGrad', '#8b5cf6'], ['fGrad', '#ef4444']].map(([id, color]) => (
                              <linearGradient key={id} id={id} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={color} stopOpacity={0.5} />
                                <stop offset="95%" stopColor={color} stopOpacity={0.05} />
                              </linearGradient>
                            ))}
                          </defs>
                          <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} interval={1} />
                          <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={30} />
                          <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [`${v}g`, n]} />
                          <Area type="monotone" dataKey="p" name="Protein" stackId="1" stroke="#3b82f6" strokeWidth={1.5} fill="url(#pGrad)" />
                          <Area type="monotone" dataKey="c" name="Carbs" stackId="1" stroke="#8b5cf6" strokeWidth={1.5} fill="url(#cGrad)" />
                          <Area type="monotone" dataKey="f" name="Fat" stackId="1" stroke="#ef4444" strokeWidth={1.5} fill="url(#fGrad)" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  {/* ── Chart 5: Day of Week Pattern ── */}
                  {Object.keys(dowMap).length >= 3 && (
                    <div style={{ backgroundColor: '#fff', borderRadius: 20, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', marginBottom: 16 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b', marginBottom: 4 }}>Intake by Day of Week</div>
                      <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 16 }}>Your average calories — do you overeat on weekends?</div>
                      <ResponsiveContainer width="100%" height={160}>
                        <BarChart data={dowData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                          <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                          <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={35} domain={[0, 'dataMax + 200']} />
                          <Tooltip contentStyle={tooltipStyle} formatter={v => [`${v} kcal`, 'Avg']} />
                          <ReferenceLine y={target} stroke="#f97316" strokeDasharray="4 3" strokeOpacity={0.5} />
                          <Bar dataKey="avg" radius={[6, 6, 0, 0]} maxBarSize={36}>
                            {dowData.map((d, i) => (
                              <Cell key={i} fill={d.avg === 0 ? '#f1f5f9' : d.avg > target ? '#ef4444' : d.avg > target * 0.9 ? '#f59e0b' : '#10b981'} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  {logged14.length < 2 && (
                    <div style={{ backgroundColor: '#fff', borderRadius: 20, padding: 40, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', textAlign: 'center' }}>
                      <div style={{ fontSize: 32, marginBottom: 12 }}>📊</div>
                      <div style={{ fontSize: 14, color: '#94a3b8' }}>Log food for at least 2 days to see your charts</div>
                    </div>
                  )}
                </div>
              );
            })()}
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

      <InstallPrompt />

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
      {showScanner && <BarcodeScanner onDetect={handleBarcode} onClose={() => setShowScanner(false)} />}
      {showExerciseModal && <ExerciseModal onConfirm={addExercise} onClose={() => setShowExerciseModal(false)} />}
      {showCustomFoodModal && <CustomFoodModal onSave={saveCustomFood} onClose={() => setShowCustomFoodModal(false)} />}
      {saveMealTarget && <SaveMealModal mealLabel={saveMealTarget.label} onSave={name => saveMealTemplate(saveMealTarget.meal, name)} onClose={() => setSaveMealTarget(null)} />}
      {loadMealTarget && <SavedMealsModal savedMeals={savedMeals} onLoad={loadMealTemplate} onDelete={deleteMealTemplate} onClose={() => setLoadMealTarget(null)} />}
    </div>
  );
}
