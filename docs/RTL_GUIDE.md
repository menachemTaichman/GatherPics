# RTL Support Guide

This guide provides patterns and best practices for implementing Right-to-Left (RTL) language support across the application.

## Quick Reference

### ✅ DO: Use These Patterns

#### 1. **Set `dir` Attribute on Containers**
```jsx
const { isRTL } = useRTL();
<div dir={isRTL ? 'rtl' : 'ltr'}>
  {/* Content automatically adapts */}
</div>
```

#### 2. **Flex Containers with Multiple Children**
```jsx
// ✅ Good - gap automatically respects RTL
<div className="flex items-center gap-3">
  <Icon />
  <Text />
</div>

// ❌ Bad - space-x doesn't respect RTL
<div className="flex items-center space-x-3">
  <Icon />
  <Text />
</div>
```

#### 3. **Labels with Values**
```jsx
const { me } = useRTL();
<span className={`font-semibold ${me('2')}`}>Label:</span>
<span>Value</span>
```

#### 4. **Buttons with Icons After Text**
```jsx
// Text first, icon second in DOM - dir="rtl" handles reversal
<button className="flex items-center gap-2">
  <span>Text</span>
  <Icon />
</button>
```

#### 5. **Absolute Positioning**
```jsx
const { startClass } = useRTL();
<button className={`absolute top-4 ${startClass('4')}`}>
  Close
</button>
```

### ❌ DON'T: Avoid These

#### 1. **Physical Positioning**
```jsx
// ❌ Bad
<div className={isRTL ? 'right-4' : 'left-4'}>

// ✅ Good
const { startClass } = useRTL();
<div className={startClass('4')}>
```

#### 2. **Explicit flex-row-reverse with dir**
```jsx
// ❌ Bad - redundant
<div dir="rtl" className="flex-row-reverse">

// ✅ Good - let dir handle it
<div dir="rtl" className="flex">
```

#### 3. **space-x with RTL**
```jsx
// ❌ Bad - doesn't respect RTL
<div className="flex space-x-2">

// ✅ Good - use gap
<div className="flex gap-2">
```

#### 4. **useRTL Functions in useEffect Dependencies**
```jsx
// ❌ Bad - causes infinite loops (function references change)
const { start, isRTL } = useRTL();
useEffect(() => {
  // ... code using start()
}, [start, isRTL]); // start() reference changes on every render

// ✅ Good - compute direction inside effect or use isRTL only
const { isRTL } = useRTL();
useEffect(() => {
  const direction = isRTL ? 'right' : 'left';
  // ... code using direction
}, [isRTL]); // isRTL is stable

// ✅ Also Good - for translation functions, use language instead of t()
const { t, i18n } = useTranslation();
useEffect(() => {
  document.title = t('about.title');
}, [i18n.language]); // NOT [t] - t() reference changes
```

## Common Patterns

### Icon + Text Container
```jsx
<div className="flex items-center gap-3">
  <Icon className="w-5 h-5" />
  <span>Text</span>
</div>
```

### Button with Icon After Text
```jsx
<button className="flex items-center gap-2">
  <span>Label</span>
  <Icon className="w-4 h-4" />
</button>
```

### Label + Input Field
```jsx
const { me } = useRTL();
<div className="flex items-center">
  <label className={me('2')}>Email:</label>
  <input />
</div>
```

### Input with Icon
```jsx
const { startClass, ps, pe } = useRTL();
// ✅ Good - RTL-aware padding for icon side and opposite side
<div className="relative">
  <Icon className={`absolute ${startClass('3')} top-1/2 transform -translate-y-1/2`} />
  <input 
    dir={isRTL ? 'rtl' : 'ltr'}
    className={`w-full ${ps('10')} ${pe('4')} py-2 border border-gray-300 rounded-lg`}
    placeholder={t('form.search')}
  />
</div>

// ❌ Bad - Hardcoded padding doesn't respect RTL
<div className="relative">
  <Icon className={`absolute ${startClass('3')} top-1/2 transform -translate-y-1/2`} />
  <input className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg" />
</div>
```

**Key Points for Input Fields with Icons:**
1. **Always add `dir` attribute** - `dir={isRTL ? 'rtl' : 'ltr'}` ensures placeholder text and input text direction are correct
2. **Use `ps()` for icon-side padding** - `ps('10')` adds padding-left in LTR, padding-right in RTL (where icon is positioned)
3. **Use `pe()` for opposite-side padding** - `pe('4')` adds padding-right in LTR, padding-left in RTL
4. **Never hardcode `pl-*` or `pr-*`** - These don't adapt to RTL and cause placeholder text to overlap icons

**Special Cases - Input Text LTR, Placeholder RTL:**
For email and phone inputs, the **input value** should always be LTR (international format), but the **placeholder text** should respect the page direction (RTL in Hebrew):

```jsx
const { isRTL } = useRTL();

// ✅ Good - Input text LTR, placeholder RTL in Hebrew
<input
  type="email"
  dir="ltr"
  className={`w-full px-3 py-2 border rounded-lg ${isRTL ? '[&::placeholder]:[direction:rtl] [&::placeholder]:[text-align:right]' : ''}`}
  placeholder={t('form.email')}
/>

<input
  type="tel"
  dir="ltr"
  className={`w-full px-3 py-2 border rounded-lg ${isRTL ? '[&::placeholder]:[direction:rtl] [&::placeholder]:[text-align:right]' : ''}`}
  placeholder={t('form.phone')}
/>

// ✅ Good - Regular text input follows page direction for both text and placeholder
<input
  type="text"
  dir={isRTL ? 'rtl' : 'ltr'}
  placeholder={t('form.name')}
/>
```

**Key Points:**
1. **`dir="ltr"`** - Always set to LTR for email/phone inputs to ensure input values are always LTR
2. **CSS placeholder override** - Use Tailwind arbitrary values `[&::placeholder]:[direction:rtl]` and `[&::placeholder]:[text-align:right]` to make placeholder RTL only when `isRTL` is true
3. **Conditional className** - Apply placeholder styles only when `isRTL` is true: `${isRTL ? '[&::placeholder]:[direction:rtl] [&::placeholder]:[text-align:right]' : ''}`
4. **Result**: 
   - Placeholder displays RTL (Hebrew) on the right side: "הכנס מספר טלפון"
   - Input values stay LTR: "user@example.com" or "+1234567890"
   - Placeholder position remains stable when focusing/editing the field

**Why this works:**
- The `dir="ltr"` attribute ensures the input text direction is always LTR
- CSS `::placeholder` pseudo-element allows us to override only the placeholder direction/alignment
- No JavaScript handlers needed - pure CSS solution that's stable and performant

**Number Input Fields with Spinners:**
For number input fields (with up/down arrows), use RTL direction to properly position the spinner controls:

```jsx
const { isRTL } = useRTL();

// ✅ Good - Number input respects RTL for spinner positioning
<input
  type="number"
  dir={isRTL ? 'rtl' : 'ltr'}
  className="w-full px-3 py-2 border rounded-lg"
  placeholder={t('form.quantity')}
/>

// ❌ Bad - Number input always LTR (spinner on wrong side in RTL)
<input
  type="number"
  dir="ltr"
  className="w-full px-3 py-2 border rounded-lg"
  placeholder={t('form.quantity')}
/>
```

**Key Points for Number Inputs:**
1. **Use `dir={isRTL ? 'rtl' : 'ltr'}`** - Number inputs should respect page direction for proper spinner control positioning
2. **Spinner controls** - In RTL mode, the up/down arrows appear on the left side (start), which is correct for RTL layouts
3. **Numeric values** - The actual numbers display correctly in both directions, but the spinner controls need proper positioning

**Input Direction Summary:**
- **Text inputs** (`type="text"`): `dir={isRTL ? 'rtl' : 'ltr'}` - Follow page direction
- **Email inputs** (`type="email"`): `dir="ltr"` - Always LTR (international format)
- **Phone inputs** (`type="tel"`): `dir="ltr"` - Always LTR (international format)
- **Number inputs** (`type="number"`): `dir={isRTL ? 'rtl' : 'ltr'}` - Respect page direction for spinner positioning
- **Date inputs** (`type="date"`): `dir="ltr"` - Always LTR (standard date format)

### Radio Buttons / Checkboxes
```jsx
// ✅ Good - use gap for spacing between input and label
<label className="flex items-center gap-2 cursor-pointer">
  <input type="radio" />
  <span>Label Text</span>
</label>

// ❌ Bad - me() doesn't work well for flex children
<label className="flex items-center cursor-pointer">
  <input type="radio" />
  <span className={me('2')}>Label Text</span>
</label>
```

### Toggle Switches

Toggle switches require special handling to work correctly in RTL. The key is to:
1. Position the circle at a constant start position
2. Use CSS transforms (`translate-x-*`) to move it when checked
3. Use conditional transforms based on RTL state

```jsx
const { isRTL } = useRTL();

// ✅ Good - Toggle switch with proper RTL support
<button
  onClick={() => setChecked(!checked)}
  className={`w-10 h-6 rounded-full relative transition-colors ${checked ? 'bg-primary-600' : 'bg-gray-300'}`}
  aria-pressed={checked}
>
  <span 
    className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${
      isRTL ? 'right-0.5' : 'left-0.5'
    } ${
      checked ? (isRTL ? '-translate-x-4' : 'translate-x-4') : ''
    }`} 
  />
</button>

// ✅ Good - Toggle switch with label (FeedbackFormModal pattern)
<label className="relative inline-flex items-center gap-3 cursor-pointer select-none">
  <input
    type="checkbox"
    checked={checked}
    onChange={(e) => setChecked(e.target.checked)}
    className="sr-only peer"
  />
  <div className={`w-10 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer-checked:bg-blue-600 peer-disabled:opacity-50 after:content-[''] after:absolute after:top-[2px] ${
    isRTL 
      ? 'after:right-[2px] peer-checked:after:-translate-x-5' 
      : 'after:left-[2px] peer-checked:after:translate-x-5'
  } after:bg-white after:border after:rounded-full after:h-4 after:w-4 after:transition-all after:border-white`}></div>
  <span className="text-sm text-gray-700">Label Text</span>
</label>

// ❌ Bad - Using position classes directly for checked state
<button className="...">
  <span className={`absolute ${checked ? (isRTL ? 'left-0.5' : 'right-0.5') : (isRTL ? 'right-0.5' : 'left-0.5')}`} />
</button>
```

**Key Points for Toggle Switches:**
1. **Constant start position** - Always position the circle at the start (`left-0.5` in LTR, `right-0.5` in RTL)
2. **Use transforms** - Apply `translate-x-4` (or `translate-x-5` for smaller circles) when checked, not position changes
3. **RTL direction** - In RTL, use negative translate (`-translate-x-4`) to move left, positive translate (`translate-x-4`) in LTR to move right
4. **Calculate movement** - Container width (40px for `w-10`) - left padding (2px for `0.5`) - circle width (20px for `w-5`) - right padding (2px) = 16px movement (`translate-x-4`)
5. **For `w-4` circles** - Use `translate-x-5` (20px movement) for proper positioning

### Absolute Positioned Elements
```jsx
const { startClass, endClass } = useRTL();
// Top-left in LTR, top-right in RTL
<button className={`absolute top-4 ${startClass('4')}`}>
  Close
</button>
```

### Hover Tooltips
```jsx
const { t } = useTranslation();
// ✅ Good - Both title (for hover) and aria-label (for accessibility)
<button
  type="button"
  onClick={() => setShowPassword(!showPassword)}
  title={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
  aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
>
  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
</button>

// ❌ Bad - Missing title attribute (no hover tooltip)
<button
  type="button"
  onClick={() => setShowPassword(!showPassword)}
  aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
>
  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
</button>

// ❌ Bad - Hardcoded English text
<button
  type="button"
  title={showPassword ? 'Hide password' : 'Show password'}
>
  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
</button>
```

**Best Practices for Tooltips**:
1. **Always use both `title` and `aria-label`** - `title` provides hover tooltips, `aria-label` provides accessibility
2. **Use translations** - Never hardcode tooltip text, always use `t()` function
3. **Keep tooltips concise** - Short, descriptive text works best
4. **Test in both languages** - Ensure tooltips display correctly in LTR and RTL modes

### Navigation Arrows

Navigation arrows (chevrons, arrow icons) must be swapped both visually and functionally in RTL mode to match user expectations.

```jsx
const { isRTL } = useRTL();

// ✅ Good - Navigation arrows swapped in RTL
<button
  onClick={() => handleNavigate('prev')}
  title={t('previous')}
  aria-label={t('previous')}
>
  {isRTL ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
</button>
<button
  onClick={() => handleNavigate('next')}
  title={t('next')}
  aria-label={t('next')}
>
  {isRTL ? <ChevronLeft className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
</button>

// ❌ Bad - Arrows not swapped in RTL
<button onClick={() => handleNavigate('prev')}>
  <ChevronLeft className="w-5 h-5" />
</button>
<button onClick={() => handleNavigate('next')}>
  <ChevronRight className="w-5 h-5" />
</button>
```

**Keyboard Navigation**:
Arrow key handlers must also swap directions in RTL mode:

```jsx
const { isRTL } = useRTL();

// ✅ Good - Keyboard navigation swapped in RTL
const handleKeys = (e) => {
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    handleNavigate(isRTL ? 'next' : 'prev');
    return true;
  }
  if (e.key === 'ArrowRight') {
    e.preventDefault();
    handleNavigate(isRTL ? 'prev' : 'next');
    return true;
  }
  return false;
};

// ❌ Bad - Keyboard navigation not swapped in RTL
const handleKeys = (e) => {
  if (e.key === 'ArrowLeft') {
    handleNavigate('prev'); // Wrong direction in RTL
  }
  if (e.key === 'ArrowRight') {
    handleNavigate('next'); // Wrong direction in RTL
  }
};
```

**Key Points for Navigation Arrows**:
1. **Visual swap** - "Previous" button shows `ChevronRight` in RTL, `ChevronLeft` in LTR
2. **Visual swap** - "Next" button shows `ChevronLeft` in RTL, `ChevronRight` in LTR
3. **Functional swap** - `ArrowLeft` key navigates to 'next' in RTL, 'prev' in LTR
4. **Functional swap** - `ArrowRight` key navigates to 'prev' in RTL, 'next' in LTR
5. **Include `isRTL` in dependencies** - Add `isRTL` to callback dependency arrays when used

**Why this works**:
- In RTL, users expect the arrow pointing right (→) to go to the "next" item (which is visually to the left)
- In RTL, users expect the arrow pointing left (←) to go to the "previous" item (which is visually to the right)
- Keyboard arrow keys should match the visual direction expectations

## Component Checklist

When adding RTL support to a component:

- [ ] Import `useRTL` hook
- [ ] Import `useTranslation` hook
- [ ] Set `dir={isRTL ? 'rtl' : 'ltr'}` on root container
- [ ] Replace `space-x-*` with `gap-*` for flex children
- [ ] Use `gap-*` for radio buttons and checkboxes (not `me()`/`ms()`)
- [ ] Use `ms()`/`me()` for single-element spacing (labels, standalone elements)
- [ ] Put text before icons in buttons (let dir reverse)
- [ ] Use `startClass()`/`endClass()` for absolute positioning
- [ ] Replace `left-*`/`right-*` with `startClass()`/`endClass()`
- [ ] For toggle switches: Use constant position + CSS transforms (not position changes)
- [ ] Replace all hardcoded text with translation keys using `t()`
- [ ] Add `title` and `aria-label` attributes to interactive elements (buttons, icons) for tooltips
- [ ] For navigation arrows: Swap chevron icons in RTL (prev shows ChevronRight, next shows ChevronLeft)
- [ ] For navigation arrows: Swap keyboard arrow key directions in RTL (ArrowLeft → next, ArrowRight → prev)
- [ ] Test in both LTR and RTL modes
- [ ] Test tooltips in both languages
- [ ] Test toggle switches move correctly in both directions
- [ ] Test navigation arrows work correctly in both directions (visual and keyboard)

## Migration Example

### Before
```jsx
<div className="flex items-center space-x-3">
  <Icon className="absolute left-3" />
  <button className="ml-2">Action</button>
</div>
```

### After
```jsx
const { isRTL, startClass, ms } = useRTL();
<div dir={isRTL ? 'rtl' : 'ltr'} className="flex items-center gap-3">
  <Icon className={`absolute ${startClass('3')}`} />
  <button className={ms('2')}>Action</button>
</div>
```

## Key Principles

1. **Let `dir` do the work** - Most layout automatically adapts with `dir="rtl"`
2. **Use `gap` for flex spacing** - Automatically respects RTL
   - ✅ Use `gap` for flex containers with multiple children (icons+text, radio buttons, checkboxes)
   - ✅ Use `ms()`/`me()` for single-element margins (labels, standalone spacing)
3. **Use logical utilities** - `ms()`/`me()` for margins, `startClass()`/`endClass()` for positioning
4. **Text before icons** - Put text first in DOM, let `dir` reverse order
5. **Minimal explicit code** - Most components need just `dir` and `gap`

## Spacing Rules

### When to Use `gap`
- ✅ Flex containers with multiple children (icon + text, button + button)
- ✅ Radio buttons and checkboxes (input + label text)
- ✅ Any flex container where children need spacing between them

### When to Use `ms()`/`me()`
- ✅ Single elements that need margin (label before value, standalone spacing)
- ✅ Elements that aren't in a flex container with siblings
- ❌ NOT for spacing between flex children (use `gap` instead)

### When to Use `ps()`/`pe()` (Padding)
- ✅ **Input fields with icons** - Use `ps()` for padding on the icon side, `pe()` for opposite side
- ✅ **Input placeholders** - Always add `dir={isRTL ? 'rtl' : 'ltr'}` to input/textarea elements for correct text direction
- ❌ **Never hardcode `pl-*` or `pr-*`** - These don't adapt to RTL and cause layout issues

**Padding Function Sizes:**
- `ps()` and `pe()` support sizes: `'0'`, `'1'`, `'2'`, `'3'`, `'4'`, `'10'`
- For other sizes, you may need to extend the function in `useRTL.js`

## Common Pitfalls

### Toggle Switch Not Moving in RTL

**Problem**: Toggle switch changes color but doesn't move position when language is RTL.

**Solution**: Use CSS transforms instead of changing position classes. Keep the circle at a constant start position and apply transforms when checked.

```jsx
// ❌ Bad - Circle doesn't move in RTL
<span className={`absolute ${checked ? endClass('0.5') : startClass('0.5')}`} />

// ✅ Good - Uses transforms for RTL-aware movement
<span className={`absolute ${isRTL ? 'right-0.5' : 'left-0.5'} ${checked ? (isRTL ? '-translate-x-4' : 'translate-x-4') : ''}`} />
```

**Why this works:**
- Position (`left-0.5`/`right-0.5`) stays constant based on RTL state
- Transform (`translate-x-4`/`-translate-x-4`) moves the circle when checked
- Transforms work correctly in both directions

**Calculation:**
- Container width: `w-10` = 40px
- Circle width: `w-5` = 20px
- Padding: 2px on each side (0.5 = 2px)
- Movement needed: 40px - 2px - 20px - 2px = 16px = `translate-x-4`
- For `w-4` circles (16px): Use `translate-x-5` (20px movement)

### Infinite Loops in useEffect

**Problem**: Including `useRTL` function references (`start()`, `end()`, `ms()`, etc.) or translation functions (`t()`) in `useEffect` dependency arrays causes infinite re-renders because these function references change on every render.

**Solution**: 
- For `useRTL` functions: Compute the direction string inside the effect based on `isRTL` (which is stable)
- For translation functions: Use `i18n.language` instead of `t` in dependencies

**Example**:
```jsx
// ❌ Bad - infinite loop
const { start, isRTL } = useRTL();
useEffect(() => {
  setStyle({ [start()]: '10px' });
}, [start, isRTL]); // start() reference changes every render!

// ✅ Good - stable dependencies
const { isRTL } = useRTL();
useEffect(() => {
  const direction = isRTL ? 'right' : 'left';
  setStyle({ [direction]: '10px' });
}, [isRTL]); // isRTL is stable
```

### Translation Function Best Practices

**Problem**: Translations not working or showing keys instead of values, especially when used in arrays/objects created during render.

**Solution**: Follow these patterns for consistent translation behavior:

#### 1. **Simple Pattern (Recommended)**
```jsx
// ✅ Good - Direct usage in render, no memoization needed
const { t } = useTranslation();

const sections = [
  { id: 'about', title: t('about.about') },
  { id: 'terms', title: t('about.termsConditions') }
];

// Sections array is recreated on each render, ensuring fresh translations
```

#### 2. **For useEffect Dependencies**
```jsx
// ❌ Bad - t() in dependencies causes issues
const { t } = useTranslation();
useEffect(() => {
  document.title = t('about.title');
}, [t]); // t() reference changes every render!

// ✅ Good - use i18n.language instead
import i18n from '../i18n';
const { t } = useTranslation();
useEffect(() => {
  document.title = t('about.title');
}, [i18n.language]); // Language change triggers update
```

#### 3. **Import i18n for Language Detection**
```jsx
// ✅ Good - Import i18n instance for language detection
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';

export default function MyComponent() {
  const { t } = useTranslation(); // Use t() for translations
  
  useEffect(() => {
    const lang = i18n.language || 'en'; // Use i18n for language
    // Load resources based on language
  }, [i18n.language]); // Track language changes
}
```

#### 4. **Avoid Memoization of Translated Arrays**
```jsx
// ❌ Bad - Memoization can cache stale translations
const sections = useMemo(() => [
  { title: t('about.about') },
  { title: t('about.terms') }
], [t]); // t() changes, but memo might not update correctly

// ✅ Good - Let React recreate on each render
const sections = [
  { title: t('about.about') },
  { title: t('about.terms') }
]; // Fresh translations on every render
```

#### 5. **Translation Debugging**
```jsx
// Add debug logging to diagnose translation issues
useEffect(() => {
  const resourceBundle = i18n.getResourceBundle(i18n.language, 'translation');
  console.log('Translation Debug:', {
    tResult: t('about.termsConditions'),
    i18nLanguage: i18n.language,
    i18nReady: i18n.isInitialized,
    resourceBundleKeys: Object.keys(resourceBundle || {}).slice(0, 20),
    aboutSection: resourceBundle?.about,
    directAccess: resourceBundle?.about?.termsConditions
  });
}, [i18n.language]); // Use i18n.language, not t
```

#### 6. **Hebrew Pluralization and Word Order**

**Problem**: In Hebrew, there are two important considerations:
1. **Verb/Adjective Forms**: Some words change form based on singular/plural (e.g., "נבחרה" singular vs "נבחרו" plural)
2. **Word Order**: For singular items, Hebrew uses "אחת" (one) after the noun, not a numeral before it
   - ❌ Wrong: "נבחרה 1 קבוצה" (selected 1 group)
   - ✅ Correct: "נבחרה קבוצה אחת" (selected group one)
   - ✅ Plural: "נבחרו 2 קבוצות" (selected 2 groups)

**Solution**: Handle Hebrew word order differently for singular vs plural:

```jsx
// ✅ Good - Handle Hebrew singular word order correctly
// In en.json:
{
  "requestForm": {
    "selectedSingular": "Selected",
    "selectedPlural": "Selected",
    "one": "one",
    "group": "group",
    "groupsPlural": "groups"
  }
}

// In he.json:
{
  "requestForm": {
    "selectedSingular": "נבחרה",
    "selectedPlural": "נבחרו",
    "one": "אחת",
    "group": "קבוצה",
    "groupsPlural": "קבוצות"
  }
}

// In component:
const { t } = useTranslation();
const { isRTL } = useRTL();

<p>
  {count === 1 && isRTL ? (
    // Hebrew singular: "נבחרה קבוצה אחת"
    `${t('requestForm.selectedSingular')} ${t('requestForm.group')} ${t('requestForm.one')}`
  ) : (
    // Plural or English: "נבחרו 2 קבוצות" or "Selected 1 group"
    `${count !== 1 ? t('requestForm.selectedPlural') : t('requestForm.selectedSingular')} ${count} ${count !== 1 ? t('requestForm.groupsPlural') : t('requestForm.group')}`
  )}
</p>
```

**Key Principles**:
1. **Check Hebrew forms** - Verify if Hebrew requires different verb/adjective forms for singular/plural
2. **Create separate keys** - Use `singular` and `plural` suffixes (e.g., `selectedSingular`, `selectedPlural`)
3. **Add "one" key** - For Hebrew, add a translation key for "אחת" (feminine singular "one")
4. **Handle word order** - Check if language is Hebrew and count is 1, then use: verb + noun + "אחת"
5. **Use `isRTL` from useRTL** - Use `isRTL` to detect Hebrew instead of `i18n.language` to avoid infinite render loops
6. **English can be same** - English keys can have the same value, but keep separate keys for consistency

**Important**: Use `isRTL` from `useRTL()` hook instead of `i18n.language === 'he'` in render to avoid infinite render loops. The `isRTL` value is stable and won't cause re-render issues.

#### 7. **Common Translation Issues**

**Problem**: Translation keys return the key itself instead of the translated value.

**Common Causes**:
1. **Wrong JSON structure** - Key nested under wrong parent (e.g., `pages.about.termsConditions` instead of `about.termsConditions`)
2. **Key doesn't exist** - Typo in key name or missing from JSON
3. **i18n not initialized** - Translations loaded before i18n is ready

**Solution**:
```jsx
// ✅ Verify JSON structure matches key path
// In en.json, ensure structure is:
{
  "about": {
    "termsConditions": "Terms & Conditions"
  }
}
// NOT nested under another object like:
{
  "pages": {
    "about": {
      "termsConditions": "Terms & Conditions"
    }
  }
}

// ✅ Use debug logging to verify structure
const resourceBundle = i18n.getResourceBundle(i18n.language, 'translation');
console.log('About section exists:', !!resourceBundle?.about);
console.log('Terms key exists:', !!resourceBundle?.about?.termsConditions);
```

**Key Principles**:
1. **Use `t()` directly in render** - Don't memoize arrays/objects with translations
2. **Use `i18n.language` for dependencies** - Not `t()` function reference
3. **Import `i18n` instance** - For language detection and resource access
4. **Let React handle re-renders** - Translations update automatically when language changes

## Migrated Components

The following components have been fully migrated to support RTL and translations:

### Pages
- ✅ `src/frontend/pages/HomePage.jsx` - Home page with event listings
- ✅ `src/frontend/pages/AboutPage.jsx` - About page with markdown content and sidebar navigation

### Layout Components
- ✅ `src/frontend/components/layout/HamburgerMenu.jsx` - Hamburger menu with language selector
- ✅ `src/frontend/components/layout/AccountModal.jsx` - Account settings modal

### Auth Components
- ✅ `src/frontend/components/auth/LoginModal.jsx` - Login modal with password visibility toggle
- ✅ `src/frontend/components/auth/RequestPasswordResetModal.jsx` - Password reset request modal
- ✅ `src/frontend/components/profiles/ResetPasswordModal.jsx` - Password reset modal

### Profile Components
- ✅ `src/frontend/components/profiles/ChangePasswordModal.jsx` - Change password modal
- ✅ `src/frontend/components/profiles/PublicProfilePasswordModal.jsx` - Public profile password modal

### Feedback Components
- ✅ `src/frontend/components/feedbacks/FeedbackFormModal.jsx` - Feedback form modal

### Migration Status
These components have been updated with:
- RTL support using `dir` attribute and `useRTL` hook
- All hardcoded text replaced with translation keys
- RTL-aware spacing using `gap`, `ms()`, `me()`, `startClass()`, and `endClass()`
- Proper handling of password toggle buttons with `title` and `aria-label` attributes for hover tooltips

### Components Still Needing Migration
- ⚠️ `src/frontend/components/profiles/EditProfileModal.jsx` - Has hardcoded English tooltip text that needs translation

