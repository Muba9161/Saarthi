/**
 * The English source catalogue.
 *
 * Keys *are* the English text. Two reasons that beats invented key names here:
 * a missing translation falls through to a correct English sentence rather
 * than to `nav.fleet.trucks`, and existing screens can be wrapped in `t()` one
 * at a time without an ID-naming exercise across 142 files first.
 *
 * The cost is that changing the English wording orphans the translations for
 * that string. That is the right trade for this codebase — the alternative
 * failure is a driver seeing a raw key on a safety screen.
 *
 * Only what everybody sees is listed: the shell, navigation, sign-in and
 * registration, the wizard chrome, and the words that recur on every screen.
 * The deep operational surfaces are deliberately absent and render in English
 * until their copy has been through review.
 */
export const en = {
  // --- Navigation: section headings ----------------------------------------
  Operations: 'Operations',
  Fleet: 'Fleet',
  Marketplace: 'Marketplace',
  Travel: 'Travel',
  Connect: 'Connect',
  Intelligence: 'Intelligence',
  Demo: 'Demo',
  Driving: 'Driving',
  Safety: 'Safety',
  Platform: 'Platform',
  Administration: 'Administration',

  // --- Navigation: destinations --------------------------------------------
  'Command centre': 'Command centre',
  Dashboard: 'Dashboard',
  'Live map': 'Live map',
  Trips: 'Trips',
  Orders: 'Orders',
  Trucks: 'Trucks',
  Vehicles: 'Vehicles',
  Drivers: 'Drivers',
  Documents: 'Documents',
  Maintenance: 'Maintenance',
  Fuel: 'Fuel',
  Toll: 'Toll',
  Loans: 'Loans',
  'Browse materials': 'Browse materials',
  Requirements: 'Requirements',
  Materials: 'Materials',
  Resale: 'Resale',
  'Find travel': 'Find travel',
  'My bookings': 'My bookings',
  Packages: 'Packages',
  Bookings: 'Bookings',
  'QR codes': 'QR codes',
  'Telemetry alerts': 'Telemetry alerts',
  Devices: 'Devices',
  Analytics: 'Analytics',
  'AI Copilot': 'AI Copilot',
  'GPS simulator': 'GPS simulator',
  'My trip': 'My trip',
  Nearby: 'Nearby',
  'My score': 'My score',
  SOS: 'SOS',
  Incidents: 'Incidents',
  Notifications: 'Notifications',
  'My profile': 'My profile',
  Verification: 'Verification',
  Overview: 'Overview',
  Organizations: 'Organizations',
  Users: 'Users',
  'Audit log': 'Audit log',

  // --- Shell ----------------------------------------------------------------
  Live: 'Live',
  Offline: 'Offline',
  'Account menu': 'Account menu',
  'Profile & settings': 'Profile & settings',
  'Sign out': 'Sign out',
  'Expand navigation': 'Expand navigation',
  'Collapse navigation': 'Collapse navigation',
  'Switch theme': 'Switch theme',
  Language: 'Language',
  'Choose your language': 'Choose your language',

  // --- Common actions -------------------------------------------------------
  Save: 'Save',
  'Save changes': 'Save changes',
  Cancel: 'Cancel',
  Delete: 'Delete',
  Remove: 'Remove',
  Edit: 'Edit',
  Add: 'Add',
  Close: 'Close',
  Search: 'Search',
  Filter: 'Filter',
  Continue: 'Continue',
  Back: 'Back',
  Done: 'Done',
  Next: 'Next',
  Submit: 'Submit',
  Discard: 'Discard',
  Retry: 'Retry',
  'Try again': 'Try again',
  Yes: 'Yes',
  No: 'No',
  Optional: 'Optional',
  optional: 'optional',
  Required: 'Required',

  // --- States ---------------------------------------------------------------
  'Loading…': 'Loading…',
  'Nothing here yet': 'Nothing here yet',
  'No results': 'No results',
  'Something went wrong': 'Something went wrong',
  'You do not have access to this': 'You do not have access to this',
  Saved: 'Saved',
  'Saving…': 'Saving…',

  // --- Sign in --------------------------------------------------------------
  'Welcome back': 'Welcome back',
  'Sign in to Saarthi': 'Sign in to Saarthi',
  'Enter your details to reach your fleet.': 'Enter your details to reach your fleet.',
  'Email address': 'Email address',
  Password: 'Password',
  'Forgot password?': 'Forgot password?',
  'Sign in': 'Sign in',
  'New to Saarthi?': 'New to Saarthi?',
  'Create an account': 'Create an account',
  'Already have an account?': 'Already have an account?',
  'Back to sign in': 'Back to sign in',

  // --- Registration ---------------------------------------------------------
  'Create your account': 'Create your account',
  'Set up Saarthi for how you actually work.': 'Set up Saarthi for how you actually work.',
  'Getting set up': 'Getting set up',
  'I am a…': 'I am a…',
  'Account type': 'Account type',
  'Your details': 'Your details',
  'Your business': 'Your business',
  'Driver details': 'Driver details',
  Security: 'Security',
  'First name': 'First name',
  'Last name': 'Last name',
  'Mobile number': 'Mobile number',
  'Company name': 'Company name',
  'Business name': 'Business name',
  'Create account': 'Create account',
  'Fleet owner': 'Fleet owner',
  Customer: 'Customer',
  Supplier: 'Supplier',
  'Travel & tour operator': 'Travel & tour operator',
  'Truck association': 'Truck association',
  Driver: 'Driver',

  // --- Language step --------------------------------------------------------
  'Your language': 'Your language',
  'How Saarthi speaks to you.': 'How Saarthi speaks to you.',
  'Which language should Saarthi use?': 'Which language should Saarthi use?',
  'You can change this later from your profile.': 'You can change this later from your profile.',
  'Not translated yet — shows in English': 'Not translated yet — shows in English',

  // --- Wizard chrome --------------------------------------------------------
  'Step {current} of {total}': 'Step {current} of {total}',

  // --- Profile --------------------------------------------------------------
  Account: 'Account',
  'Your profile': 'Your profile',
  'Profile completion': 'Profile completion',
  'Save section': 'Save section',
  'Change password': 'Change password',
  'Current password': 'Current password',
  'New password': 'New password',
  Email: 'Email',
  Organization: 'Organization',
  'Your role': 'Your role',
  // --- Registration: step descriptions and helper copy ----------------------
  'How you will use Saarthi.': 'How you will use Saarthi.',
  'Who we should reach.': 'Who we should reach.',
  'Your fleet and licence.': 'Your fleet and licence.',
  'The organization we create for you.': 'The organization we create for you.',
  'Password and terms.': 'Password and terms.',
  'Four short steps. Nothing is saved until the last one.':
    'Four short steps. Nothing is saved until the last one.',
  'This decides what Saarthi sets up for you. It cannot be changed later from here.':
    'This decides what Saarthi sets up for you. It cannot be changed later from here.',
  'Indian mobile number, with or without +91.': 'Indian mobile number, with or without +91.',
  'Fleet invite code': 'Fleet invite code',
  'Ask your truck owner for this code.': 'Ask your truck owner for this code.',
  'Driving licence number': 'Driving licence number',
  'Saarthi creates this organization and makes you its administrator.':
    'Saarthi creates this organization and makes you its administrator.',
  'At least 10 characters, with upper case, lower case and a number.':
    'At least 10 characters, with upper case, lower case and a number.',
  'I agree to the VorldX Saarthi terms of service and privacy policy.':
    'I agree to the VorldX Saarthi terms of service and privacy policy.',
  'Association name': 'Association name',
  'Travel business name': 'Travel business name',

  // --- Account types --------------------------------------------------------
  'I own trucks and want to manage my fleet and win loads.':
    'I own trucks and want to manage my fleet and win loads.',
  'I need materials, transport, a cab or a tour, and want offers to compare.':
    'I need materials, transport, a cab or a tour, and want offers to compare.',
  'I sell materials and arrange dispatch from my yard.':
    'I sell materials and arrange dispatch from my yard.',
  'I run taxis, buses or tour packages and sell passenger journeys.':
    'I run taxis, buses or tour packages and sell passenger journeys.',
  'I represent a district association coordinating roadside help.':
    'I represent a district association coordinating roadside help.',
  'I drive for a fleet that already uses Saarthi.':
    'I drive for a fleet that already uses Saarthi.',

  // --- The panel beside the sign-in and registration forms ------------------
  'The operating system for your trucking business.':
    'The operating system for your trucking business.',
  'Saarthi connects fleet owners, drivers, suppliers and customers on one platform — from posting a load to watching it arrive.':
    'Saarthi connects fleet owners, drivers, suppliers and customers on one platform — from posting a load to watching it arrive.',
  'One fleet command centre': 'One fleet command centre',
  'Trucks, drivers, documents, orders and trips in a single operational view.':
    'Trucks, drivers, documents, orders and trips in a single operational view.',
  'Live tracking that actually moves': 'Live tracking that actually moves',
  'Realtime positions, ETAs and route deviation alerts as they happen.':
    'Realtime positions, ETAs and route deviation alerts as they happen.',
  'Driver safety network': 'Driver safety network',
  'One-tap SOS reaches nearby Saarthi trucks in expanding rings.':
    'One-tap SOS reaches nearby Saarthi trucks in expanding rings.',
  'AI grounded in your data': 'AI grounded in your data',
  'Answers built only from records your role is allowed to see.':
    'Answers built only from records your role is allowed to see.',
  'Local development build — simulated GPS, mock payments, local document storage.':
    'Local development build — simulated GPS, mock payments, local document storage.',
  'Back to vorldxsaarthi.com': 'Back to vorldxsaarthi.com',
  'Loading Saarthi…': 'Loading Saarthi…',

  // --- Demo accounts --------------------------------------------------------
  'Try it instantly': 'Try it instantly',
  'Platform admin': 'Platform admin',
  'Fleet, trips, live map, simulator': 'Fleet, trips, live map, simulator',
  'Driver app, SOS, safety score': 'Driver app, SOS, safety score',
  'Marketplace, orders, tracking': 'Marketplace, orders, tracking',
  'Verification queue, audit log': 'Verification queue, audit log',
  'Four demo accounts, password': 'Four demo accounts, password',
  'Demo credentials filled in': 'Demo credentials filled in',

  // --- Password reset -------------------------------------------------------
  'Reset your password': 'Reset your password',
  'Enter your email address and we will send you a reset link.':
    'Enter your email address and we will send you a reset link.',
  'Send reset link': 'Send reset link',
  'Check your inbox': 'Check your inbox',
  'If an account exists for that address, a password reset link has been generated.':
    'If an account exists for that address, a password reset link has been generated.',
  'Development shortcut': 'Development shortcut',
  'No email provider is configured locally, so use this link directly:':
    'No email provider is configured locally, so use this link directly:',
  'Choose a new password': 'Choose a new password',
  'Setting a new password signs you out of every other device.':
    'Setting a new password signs you out of every other device.',
  'Confirm new password': 'Confirm new password',
  'Update password': 'Update password',
  'This link is not valid': 'This link is not valid',
  'The reset link is missing its token. Request a new one and try again.':
    'The reset link is missing its token. Request a new one and try again.',
  'Request a new link': 'Request a new link',
  'Password updated': 'Password updated',
  'Sign in with your new password.': 'Sign in with your new password.',

  // --- Password field -------------------------------------------------------
  'Show password': 'Show password',
  'Hide password': 'Hide password',

  // --- Password strength ----------------------------------------------------
  // The four checks mirror `passwordSchema` in @saarthi/shared exactly. If a
  // rule changes there, these have to change with it.
  Weak: 'Weak',
  Fair: 'Fair',
  Good: 'Good',
  Strong: 'Strong',
  'At least 10 characters': 'At least 10 characters',
  'One lower case letter': 'One lower case letter',
  'One upper case letter': 'One upper case letter',
  'One number': 'One number',

  // --- Wizard chrome, counted rather than spelled out -----------------------
  // The driver branch swaps a step rather than adding one, but writing the
  // number in words is how the old copy came to say "four" about five steps.
  '{count} short steps. Nothing is saved until the last one.':
    '{count} short steps. Nothing is saved until the last one.',

  // --- Splash ---------------------------------------------------------------
  'Getting your fleet ready': 'Getting your fleet ready',
  'Checking your session': 'Checking your session',
  // --- Navigation labels reached through a variable -------------------------
  // These come from `app/navigation.ts` via `t(item.label)`. A test walks the
  // real navigation tree and fails if any label is absent here, because a
  // dynamic key cannot be caught by reading this file.
  'Vehicle registration': 'Vehicle registration',
  'Loans & EMI': 'Loans & EMI',
  'Toll & FASTag': 'Toll & FASTag',
  'SOS incidents': 'SOS incidents',
  'Nearby services': 'Nearby services',
  Deliveries: 'Deliveries',
  'Find materials': 'Find materials',
  'My orders': 'My orders',
  'Track deliveries': 'Track deliveries',
  'My travel': 'My travel',
  'Emergency desk': 'Emergency desk',
  // Requirements: the customer's cross-category front door, and the board the
  // businesses that serve it bid on.
  'My requirements': 'My requirements',
  'Bid on work': 'Bid on work',
  // Two labels that shipped before this file was checked against the real
  // navigation tables, and rendered in English on otherwise translated menus.
  'Terminal arrivals': 'Terminal arrivals',
  'Scan a vehicle': 'Scan a vehicle',
  'Trip history': 'Trip history',
  'My QR badge': 'My QR badge',
  'Verification queue': 'Verification queue',
  Business: 'Business',
  Buying: 'Buying',
  'Emergency network': 'Emergency network',
  // --- Dashboard ------------------------------------------------------------
  'Live operational picture': 'Live operational picture',
  'Fleet command centre': 'Fleet command centre',
  'Your fleet at a glance': 'Your fleet at a glance',
  'New requirement': 'New requirement',
  'Run demo simulation': 'Run demo simulation',
  'No organization selected': 'No organization selected',
  'Your account is not linked to an organization yet.':
    'Your account is not linked to an organization yet.',
  Utilisation: 'Utilisation',
  'Active trips': 'Active trips',
  'Revenue this month': 'Revenue this month',
  'Distance this month': 'Distance this month',
  'Open orders': 'Open orders',
  'Safety events': 'Safety events',
  'Trips in progress': 'Trips in progress',
  'Loading trips…': 'Loading trips…',
  'No trips in progress': 'No trips in progress',
  'Accepted orders will appear here once a trip is created.':
    'Accepted orders will appear here once a trip is created.',
  'Orders needing action': 'Orders needing action',
  'Loading orders…': 'Loading orders…',
  'Open live map': 'Open live map',
  'Documents needing attention': 'Documents needing attention',
  'Ask the Fleet Copilot': 'Ask the Fleet Copilot',
  '“What needs my attention today?” — answered from your own records.':
    '“What needs my attention today?” — answered from your own records.',
  Open: 'Open',
} as const;

/** Every translatable string. Other locales supply a subset of these. */
export type TranslationKey = keyof typeof en;

/** A locale catalogue. Partial: anything missing falls back to English. */
export type Catalogue = Partial<Record<TranslationKey, string>>;
