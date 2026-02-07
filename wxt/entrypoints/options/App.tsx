import { useState, useEffect, useRef } from 'react';
import { storage } from '@wxt-dev/storage';

type OnboardingStep = 'welcome' | 'visual' | 'cognitive' | 'success';

interface UserPreferences {
  // Font size settings
  fontSize: 'standard' | 'large' | 'extra-large';
  // Link styling
  linkStyle: 'default' | 'underline' | 'highlight' | 'border';
  // Contrast mode
  contrastMode: 'standard' | 'high-contrast-yellow';
  // Other features
  hideAds: boolean;
  simplifyLanguage: boolean;
  showBreadcrumbs: boolean;
  profileName: string;
}

function App() {
  const [step, setStep] = useState<OnboardingStep>('welcome');
  const [preferences, setPreferences] = useState<UserPreferences>({
    fontSize: 'standard',
    linkStyle: 'default',
    contrastMode: 'standard',
    hideAds: false,
    simplifyLanguage: false,
    showBreadcrumbs: false,
    profileName: 'My Profile',
  });

  const startButtonRef = useRef<HTMLButtonElement>(null!);
  const visualButtonRef = useRef<HTMLButtonElement>(null!);
  const cognitiveButtonRef = useRef<HTMLButtonElement>(null!);

  // Auto-focus on mount and step changes
  useEffect(() => {
    if (step === 'welcome' && startButtonRef.current) {
      startButtonRef.current.focus();
    } else if (step === 'visual' && visualButtonRef.current) {
      visualButtonRef.current.focus();
    } else if (step === 'cognitive' && cognitiveButtonRef.current) {
      cognitiveButtonRef.current.focus();
    }
  }, [step]);

  const handleStart = () => {
    setStep('visual');
  };

  const handleVisualNext = () => {
    setStep('cognitive');
  };

  const handleCognitiveNext = async () => {
    // Save to storage using WXT's storage API
    try {
      await storage.setItem('sync:userPreferences', preferences);
      await storage.setItem('sync:onboardingComplete', true);
      console.log('[Options] Preferences saved:', preferences);
      setStep('success');

      // Close tab after 2 seconds
      setTimeout(() => {
        window.close();
      }, 2000);
    } catch (error) {
      console.error('[Options] Failed to save preferences:', error);
    }
  };

  const updatePreference = <K extends keyof UserPreferences>(
    key: K,
    value: UserPreferences[K]
  ) => {
    setPreferences((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-8">
      <div className="max-w-6xl w-full flex gap-8">
        {/* Main Content */}
        <div className="flex-1">
          {step === 'welcome' && (
            <WelcomeScreen onStart={handleStart} buttonRef={startButtonRef} />
          )}

          {step === 'visual' && (
            <VisualNeedsScreen
              preferences={preferences}
              updatePreference={updatePreference}
              onNext={handleVisualNext}
              buttonRef={visualButtonRef}
            />
          )}

          {step === 'cognitive' && (
            <CognitiveNeedsScreen
              preferences={preferences}
              updatePreference={updatePreference}
              onNext={handleCognitiveNext}
              buttonRef={cognitiveButtonRef}
            />
          )}

          {step === 'success' && <SuccessScreen preferences={preferences} />}
        </div>

        {/* Preview Window - Only show during questionnaire */}
        {(step === 'visual' || step === 'cognitive') && (
          <PreviewWindow preferences={preferences} />
        )}
      </div>
    </div>
  );
}

// Screen 1: Welcome
function WelcomeScreen({
  onStart,
  buttonRef,
}: {
  onStart: () => void;
  buttonRef: React.RefObject<HTMLButtonElement>;
}) {
  return (
    <div className="bg-white rounded-2xl shadow-2xl p-16 text-center">
      <div className="mb-8">
        <h1 className="text-6xl font-bold text-gray-900 mb-4">
          Welcome to IEEE Extension
        </h1>
        <p className="text-2xl text-gray-600">
          Let's personalize your web browsing experience
        </p>
      </div>

      <button
        ref={buttonRef}
        onClick={onStart}
        className="px-16 py-8 bg-blue-600 text-white text-3xl font-bold rounded-2xl hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-300 transition-all transform hover:scale-105"
        aria-label="Start setup process"
      >
        Start Setup
      </button>

      <p className="mt-8 text-gray-500 text-lg">
        This will take about 2 minutes
      </p>
    </div>
  );
}

// Screen 2: Visual Needs
function VisualNeedsScreen({
  preferences,
  updatePreference,
  onNext,
  buttonRef,
}: {
  preferences: UserPreferences;
  updatePreference: <K extends keyof UserPreferences>(
    key: K,
    value: UserPreferences[K]
  ) => void;
  onNext: () => void;
  buttonRef: React.RefObject<HTMLButtonElement>;
}) {
  return (
    <div className="bg-white rounded-2xl shadow-2xl p-12">
      <div className="mb-8">
        <span className="text-blue-600 font-semibold text-lg">Step 1 of 2</span>
        <h2 className="text-4xl font-bold text-gray-900 mt-2 mb-4">
          Visual Preferences
        </h2>
        <p className="text-xl text-gray-600">
          Customize how text and links appear on web pages
        </p>
      </div>

      {/* Font Size Section */}
      <div className="mb-8">
        <h3 className="text-2xl font-bold text-gray-900 mb-4">Font Size</h3>
        <div className="space-y-3">
          <button
            ref={buttonRef}
            onClick={() => updatePreference('fontSize', 'standard')}
            className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
              preferences.fontSize === 'standard'
                ? 'border-blue-600 bg-blue-50 ring-4 ring-blue-200'
                : 'border-gray-300 hover:border-blue-400'
            }`}
            aria-pressed={preferences.fontSize === 'standard'}
          >
            <div className="flex items-center gap-3">
              <div className="text-3xl">Aa</div>
              <div>
                <h4 className="text-xl font-bold text-gray-900">Standard</h4>
                <p className="text-sm text-gray-600">Default text size</p>
              </div>
            </div>
          </button>

          <button
            onClick={() => updatePreference('fontSize', 'large')}
            className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
              preferences.fontSize === 'large'
                ? 'border-blue-600 bg-blue-50 ring-4 ring-blue-200'
                : 'border-gray-300 hover:border-blue-400'
            }`}
            aria-pressed={preferences.fontSize === 'large'}
          >
            <div className="flex items-center gap-3">
              <div className="text-4xl">Aa</div>
              <div>
                <h4 className="text-xl font-bold text-gray-900">Large</h4>
                <p className="text-sm text-gray-600">125% larger text</p>
              </div>
            </div>
          </button>

          <button
            onClick={() => updatePreference('fontSize', 'extra-large')}
            className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
              preferences.fontSize === 'extra-large'
                ? 'border-blue-600 bg-blue-50 ring-4 ring-blue-200'
                : 'border-gray-300 hover:border-blue-400'
            }`}
            aria-pressed={preferences.fontSize === 'extra-large'}
          >
            <div className="flex items-center gap-3">
              <div className="text-5xl">Aa</div>
              <div>
                <h4 className="text-xl font-bold text-gray-900">Extra Large</h4>
                <p className="text-sm text-gray-600">150% larger text</p>
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* Link Style Section */}
      <div className="mb-8">
        <h3 className="text-2xl font-bold text-gray-900 mb-4">Link Style</h3>
        <div className="space-y-3">
          <button
            onClick={() => updatePreference('linkStyle', 'default')}
            className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
              preferences.linkStyle === 'default'
                ? 'border-blue-600 bg-blue-50 ring-4 ring-blue-200'
                : 'border-gray-300 hover:border-blue-400'
            }`}
            aria-pressed={preferences.linkStyle === 'default'}
          >
            <div className="flex items-center gap-3">
              <div className="text-3xl">🔗</div>
              <div>
                <h4 className="text-xl font-bold text-gray-900">Default</h4>
                <p className="text-sm text-gray-600">Standard link appearance</p>
              </div>
            </div>
          </button>

          <button
            onClick={() => updatePreference('linkStyle', 'underline')}
            className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
              preferences.linkStyle === 'underline'
                ? 'border-blue-600 bg-blue-50 ring-4 ring-blue-200'
                : 'border-gray-300 hover:border-blue-400'
            }`}
            aria-pressed={preferences.linkStyle === 'underline'}
          >
            <div className="flex items-center gap-3">
              <div className="text-3xl">📏</div>
              <div>
                <h4 className="text-xl font-bold text-gray-900">Always Underlined</h4>
                <p className="text-sm text-gray-600">Underline all links</p>
              </div>
            </div>
          </button>

          <button
            onClick={() => updatePreference('linkStyle', 'highlight')}
            className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
              preferences.linkStyle === 'highlight'
                ? 'border-blue-600 bg-blue-50 ring-4 ring-blue-200'
                : 'border-gray-300 hover:border-blue-400'
            }`}
            aria-pressed={preferences.linkStyle === 'highlight'}
          >
            <div className="flex items-center gap-3">
              <div className="text-3xl">✨</div>
              <div>
                <h4 className="text-xl font-bold text-gray-900">Highlighted</h4>
                <p className="text-sm text-gray-600">Yellow background on links</p>
              </div>
            </div>
          </button>

          <button
            onClick={() => updatePreference('linkStyle', 'border')}
            className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
              preferences.linkStyle === 'border'
                ? 'border-blue-600 bg-blue-50 ring-4 ring-blue-200'
                : 'border-gray-300 hover:border-blue-400'
            }`}
            aria-pressed={preferences.linkStyle === 'border'}
          >
            <div className="flex items-center gap-3">
              <div className="text-3xl">⬜</div>
              <div>
                <h4 className="text-xl font-bold text-gray-900">Bordered</h4>
                <p className="text-sm text-gray-600">Thick border around links</p>
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* Contrast Mode Section */}
      <div className="mb-8">
        <h3 className="text-2xl font-bold text-gray-900 mb-4">Contrast Mode</h3>
        <div className="space-y-3">
          <button
            onClick={() => updatePreference('contrastMode', 'standard')}
            className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
              preferences.contrastMode === 'standard'
                ? 'border-blue-600 bg-blue-50 ring-4 ring-blue-200'
                : 'border-gray-300 hover:border-blue-400'
            }`}
            aria-pressed={preferences.contrastMode === 'standard'}
          >
            <div className="flex items-center gap-3">
              <div className="text-3xl">🌐</div>
              <div>
                <h4 className="text-xl font-bold text-gray-900">Standard</h4>
                <p className="text-sm text-gray-600">Normal colors</p>
              </div>
            </div>
          </button>

          <button
            onClick={() => updatePreference('contrastMode', 'high-contrast-yellow')}
            className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
              preferences.contrastMode === 'high-contrast-yellow'
                ? 'border-blue-600 bg-blue-50 ring-4 ring-blue-200'
                : 'border-gray-300 hover:border-blue-400'
            }`}
            aria-pressed={preferences.contrastMode === 'high-contrast-yellow'}
          >
            <div className="flex items-center gap-3">
              <div className="text-3xl">🔆</div>
              <div>
                <h4 className="text-xl font-bold text-gray-900">High Contrast (Yellow/Black)</h4>
                <p className="text-sm text-gray-600">Yellow text on black background</p>
              </div>
            </div>
          </button>
        </div>
      </div>

      <button
        onClick={onNext}
        className="w-full px-8 py-4 bg-blue-600 text-white text-xl font-bold rounded-xl hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-300 transition-all"
      >
        Next →
      </button>
    </div>
  );
}

// Screen 3: Cognitive Needs
function CognitiveNeedsScreen({
  preferences,
  updatePreference,
  onNext,
  buttonRef,
}: {
  preferences: UserPreferences;
  updatePreference: <K extends keyof UserPreferences>(
    key: K,
    value: UserPreferences[K]
  ) => void;
  onNext: () => void;
  buttonRef: React.RefObject<HTMLButtonElement>;
}) {
  return (
    <div className="bg-white rounded-2xl shadow-2xl p-12">
      <div className="mb-8">
        <span className="text-blue-600 font-semibold text-lg">Step 2 of 2</span>
        <h2 className="text-4xl font-bold text-gray-900 mt-2 mb-4">
          Browsing Preferences
        </h2>
        <p className="text-xl text-gray-600">
          Choose features to simplify your experience
        </p>
      </div>

      <div className="space-y-4 mb-8">
        <label
          className={`flex items-center justify-between p-6 rounded-xl border-2 cursor-pointer transition-all ${
            preferences.hideAds
              ? 'border-blue-600 bg-blue-50'
              : 'border-gray-300 hover:border-blue-400'
          }`}
        >
          <div className="flex items-center gap-4">
            <div className="text-4xl">🚫</div>
            <div>
              <h3 className="text-2xl font-bold text-gray-900">Hide Ads</h3>
              <p className="text-gray-600">Remove distracting advertisements</p>
            </div>
          </div>
          <input
            type="checkbox"
            checked={preferences.hideAds}
            onChange={(e) => updatePreference('hideAds', e.target.checked)}
            className="w-8 h-8 text-blue-600 rounded focus:ring-4 focus:ring-blue-300"
            aria-label="Hide ads toggle"
          />
        </label>

        <label
          className={`flex items-center justify-between p-6 rounded-xl border-2 cursor-pointer transition-all ${
            preferences.simplifyLanguage
              ? 'border-blue-600 bg-blue-50'
              : 'border-gray-300 hover:border-blue-400'
          }`}
        >
          <div className="flex items-center gap-4">
            <div className="text-4xl">📝</div>
            <div>
              <h3 className="text-2xl font-bold text-gray-900">Simplify Language</h3>
              <p className="text-gray-600">Use clearer, easier-to-understand words</p>
            </div>
          </div>
          <input
            type="checkbox"
            checked={preferences.simplifyLanguage}
            onChange={(e) => updatePreference('simplifyLanguage', e.target.checked)}
            className="w-8 h-8 text-blue-600 rounded focus:ring-4 focus:ring-blue-300"
            aria-label="Simplify language toggle"
          />
        </label>

        <label
          className={`flex items-center justify-between p-6 rounded-xl border-2 cursor-pointer transition-all ${
            preferences.showBreadcrumbs
              ? 'border-blue-600 bg-blue-50'
              : 'border-gray-300 hover:border-blue-400'
          }`}
        >
          <div className="flex items-center gap-4">
            <div className="text-4xl">🗺️</div>
            <div>
              <h3 className="text-2xl font-bold text-gray-900">Show Breadcrumbs</h3>
              <p className="text-gray-600">Display navigation paths on pages</p>
            </div>
          </div>
          <input
            type="checkbox"
            checked={preferences.showBreadcrumbs}
            onChange={(e) => updatePreference('showBreadcrumbs', e.target.checked)}
            className="w-8 h-8 text-blue-600 rounded focus:ring-4 focus:ring-blue-300"
            aria-label="Show breadcrumbs toggle"
          />
        </label>
      </div>

      <button
        ref={buttonRef}
        onClick={onNext}
        className="w-full px-8 py-4 bg-green-600 text-white text-xl font-bold rounded-xl hover:bg-green-700 focus:outline-none focus:ring-4 focus:ring-green-300 transition-all"
      >
        Complete Setup ✓
      </button>
    </div>
  );
}

// Screen 4: Success
function SuccessScreen({ preferences }: { preferences: UserPreferences }) {
  return (
    <div className="bg-white rounded-2xl shadow-2xl p-16 text-center">
      <div className="mb-8">
        <div className="text-8xl mb-6">✅</div>
        <h2 className="text-5xl font-bold text-gray-900 mb-4">
          You're All Set!
        </h2>
        <p className="text-2xl text-gray-600 mb-2">
          Your profile "{preferences.profileName}" is now active
        </p>
        <p className="text-lg text-gray-500">
          This window will close automatically...
        </p>
      </div>

      <div className="bg-blue-50 rounded-xl p-6 text-left">
        <h3 className="text-xl font-bold text-gray-900 mb-3">Your Settings:</h3>
        <ul className="space-y-2 text-gray-700">
          <li className="flex items-center gap-2">
            <span className="text-blue-600">✓</span>
            Font Size: <strong>{preferences.fontSize}</strong>
          </li>
          <li className="flex items-center gap-2">
            <span className="text-blue-600">✓</span>
            Link Style: <strong>{preferences.linkStyle}</strong>
          </li>
          <li className="flex items-center gap-2">
            <span className="text-blue-600">✓</span>
            Contrast: <strong>{preferences.contrastMode}</strong>
          </li>
          {preferences.hideAds && (
            <li className="flex items-center gap-2">
              <span className="text-blue-600">✓</span>
              Hide Ads enabled
            </li>
          )}
          {preferences.simplifyLanguage && (
            <li className="flex items-center gap-2">
              <span className="text-blue-600">✓</span>
              Simplify Language enabled
            </li>
          )}
          {preferences.showBreadcrumbs && (
            <li className="flex items-center gap-2">
              <span className="text-blue-600">✓</span>
              Show Breadcrumbs enabled
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}

// Preview Window Component
function PreviewWindow({ preferences }: { preferences: UserPreferences }) {
  const getPreviewStyles = () => {
    const styles: React.CSSProperties = {};

    // Zoom rate
    if (preferences.fontSize === 'large') {
      styles.zoom = 1.25;
    } else if (preferences.fontSize === 'extra-large') {
      styles.zoom = 1.5;
    }

    // Contrast mode
    if (preferences.contrastMode === 'high-contrast-yellow') {
      styles.backgroundColor = '#000000';
      styles.color = '#FFFF00';
    }

    return styles;
  };

  const getLinkStyles = () => {
    const styles: React.CSSProperties = { color: preferences.contrastMode === 'high-contrast-yellow' ? '#FFFF00' : '#2563eb' };

    if (preferences.linkStyle === 'underline') {
      styles.textDecoration = 'underline';
    } else if (preferences.linkStyle === 'highlight') {
      styles.backgroundColor = '#FEF08A';
      styles.padding = '2px 4px';
    } else if (preferences.linkStyle === 'border') {
      styles.border = '2px solid currentColor';
      styles.padding = '2px 4px';
      styles.borderRadius = '4px';
    }

    return styles;
  };

  return (
    <div className="w-96 bg-white rounded-2xl shadow-2xl p-6 sticky top-8 h-fit">
      <h3 className="text-xl font-bold text-gray-900 mb-4">Live Preview</h3>

      <div
        className="border-2 border-gray-200 rounded-lg p-4"
        style={getPreviewStyles()}
      >
        <h4 className="font-bold mb-2">Sample Webpage</h4>
        <p className="mb-3">
          This is how text will appear with your current settings.
        </p>

        <p className="mb-3">
          Here is a <span style={getLinkStyles()}>sample link</span> to show link styling.
        </p>

        {!preferences.hideAds && (
          <div className="bg-yellow-100 border border-yellow-300 rounded p-2 mb-3 text-xs text-center" style={{ backgroundColor: preferences.contrastMode === 'high-contrast-yellow' ? '#333' : undefined }}>
            [Advertisement]
          </div>
        )}

        {preferences.showBreadcrumbs && (
          <div className="text-sm mb-2" style={{ color: preferences.contrastMode === 'high-contrast-yellow' ? '#FFFF00' : '#2563eb' }}>
            Home &gt; Settings &gt; Accessibility
          </div>
        )}

        <p className="text-sm">
          {preferences.simplifyLanguage
            ? 'Easy words make reading simple.'
            : 'Complex terminology facilitates comprehension.'}
        </p>
      </div>

      <div className="mt-4 text-sm text-gray-500">
        <p className="font-semibold mb-1">Current Settings:</p>
        <ul className="space-y-1">
          <li>• Font Size: {preferences.fontSize}</li>
          <li>• Link Style: {preferences.linkStyle}</li>
          <li>• Contrast: {preferences.contrastMode}</li>
          <li>• Ads: {preferences.hideAds ? 'Hidden' : 'Visible'}</li>
          <li>• Language: {preferences.simplifyLanguage ? 'Simple' : 'Standard'}</li>
          <li>• Breadcrumbs: {preferences.showBreadcrumbs ? 'On' : 'Off'}</li>
        </ul>
      </div>
    </div>
  );
}

export default App;
