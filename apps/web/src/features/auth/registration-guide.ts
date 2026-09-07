import {
  AtSign,
  Building2,
  HandshakeIcon,
  IdCard,
  ImagePlus,
  KeyRound,
  Package,
  Plane,
  ShoppingCart,
  Smartphone,
  Ticket,
  Truck,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { RoleName, type RegisterInput, type RegistrableRole } from '@saarthi/shared';

/**
 * The script behind the guided registration.
 *
 * Six account types create six different things, ask for different documents
 * and unlock different halves of the product — and the choice cannot be undone
 * from the UI afterwards. One generic walkthrough would therefore be worse
 * than none: it would narrate a form that only one reader in six is filling
 * in.
 *
 * So the questions are per role, and this file is the whole script. Data
 * rather than JSX, for two reasons: the copy is the part that changes, and
 * keeping it out of the component means the guided flow, a future help page
 * and any printed onboarding sheet can read from one source instead of
 * drifting apart.
 *
 * Every `rule` here mirrors `registerSchema` in `@saarthi/shared`. When that
 * schema changes this text is wrong until it changes too — which is the trade
 * for telling somebody a rule *before* they trip over it rather than as a red
 * line under an answer they have already given.
 */

/**
 * Which screen to draw.
 *
 * The component switches on this to render the real control, so the set is
 * closed on purpose: a new id without a matching branch would render a
 * question with no way to answer it.
 */
export type QuestionId =
  'name' | 'email' | 'phone' | 'image' | 'organization' | 'fleet-code' | 'licence' | 'password';

export interface GuidedQuestion {
  id: QuestionId;
  /**
   * The form fields this screen owns. Validated with `form.trigger` before it
   * will let anybody past, so a wrong answer is caught on the screen that
   * asked for it rather than ten screens later.
   */
  fields: readonly (keyof RegisterInput)[];
  icon: LucideIcon;
  /** Two or three words, for the progress rail. */
  label: string;
  /** The question itself, asked as a question. */
  question: string;
  /** What to enter, and why it is being asked. */
  help: string;
  /** The constraint the form enforces. */
  rule?: string;
  example?: string;
  /** The thing people get wrong here. */
  tip?: string;
  /** A blocker rather than a nicety — shown louder than a tip. */
  warning?: string;
  /** Passable with nothing entered. Offers a Skip alongside Continue. */
  optional?: boolean;
}

/** One line of the "keep this ready" check, tickable before the questions start. */
export interface GuidePrerequisite {
  label: string;
  detail: string;
  required: boolean;
}

export interface AccountGuide {
  role: RegistrableRole;
  icon: LucideIcon;
  title: string;
  /** One line on the chooser card. */
  tagline: string;
  /** Sentences that let a reader recognise themselves. */
  chooseIf: readonly string[];
  /** What answering these questions actually creates. */
  creates: string;
  prepare: readonly GuidePrerequisite[];
  /** What the account can do the moment it exists. */
  unlocks: readonly string[];
  /** Asked in this order, after the language and account-type screens. */
  questions: readonly GuidedQuestion[];
  /** Realistic minutes for somebody who has the prerequisites to hand. */
  minutes: number;
}

/* ---------------------------------------------------------------------------
 * Questions every account type is asked
 * ------------------------------------------------------------------------ */

const NAME_QUESTION: GuidedQuestion = {
  id: 'name',
  fields: ['firstName', 'lastName'],
  icon: UserRound,
  label: 'Your name',
  question: 'What is your name?',
  help: 'Your own name, not your business name — that is asked separately. It is how Saarthi addresses you and how the people you deal with know who they are talking to.',
  rule: 'First name 2 to 60 characters, surname 1 to 60.',
};

const EMAIL_QUESTION: GuidedQuestion = {
  id: 'email',
  fields: ['email'],
  icon: AtSign,
  label: 'Email',
  question: 'What is your email address?',
  help: 'This becomes your sign-in ID, and it is where a password reset would be sent. Use an address you can open today.',
  example: 'you@company.com',
  tip: 'One email address makes one account. If yours is already registered you will be told so at the end — sign in instead of starting over.',
};

const PHONE_QUESTION: GuidedQuestion = {
  id: 'phone',
  fields: ['phone'],
  icon: Smartphone,
  label: 'Mobile',
  question: 'What is your mobile number?',
  help: 'An Indian mobile number. Type the ten digits — Saarthi puts the +91 on for you if you leave it off.',
  rule: 'Ten digits, starting with 6, 7, 8 or 9.',
  example: '9876543210',
};

const PASSWORD_QUESTION: GuidedQuestion = {
  id: 'password',
  fields: ['password'],
  icon: KeyRound,
  label: 'Password',
  question: 'Choose a password.',
  help: 'The checklist under the box ticks off each rule as you type, so you can watch the password become valid rather than guess at it.',
  rule: 'At least 10 characters, with one capital letter, one small letter and one number.',
  example: 'Monsoon2026road',
};

/** The photo screen, worded for a person rather than for a business. */
const PHOTO_QUESTION: GuidedQuestion = {
  id: 'image',
  fields: [],
  icon: ImagePlus,
  label: 'Photo',
  question: 'Add a profile photo?',
  help: 'A picture of you, shown on your profile and beside your messages. Entirely optional — skip it and add one later from your profile.',
  rule: 'JPEG, PNG, WebP or HEIC, up to 5 MB.',
  optional: true,
};

/** The same control on a business account, where it means something else. */
const LOGO_QUESTION: GuidedQuestion = {
  id: 'image',
  fields: [],
  icon: ImagePlus,
  label: 'Logo',
  question: 'Add your company logo?',
  help: 'It goes on your listings, orders and invoices — so use the mark your customers recognise, not a photograph of yourself. Optional, and addable later from settings.',
  rule: 'JPEG, PNG, WebP or HEIC, up to 5 MB.',
  optional: true,
};

/** The organization screen for the four account types that must name a business. */
function organizationQuestion(input: {
  label: string;
  question: string;
  help: string;
  example: string;
  tip: string;
}): GuidedQuestion {
  return {
    id: 'organization',
    fields: ['organizationName'],
    icon: Building2,
    label: input.label,
    question: input.question,
    help: input.help,
    rule: 'Up to 160 characters. Saarthi creates this organization and makes you its administrator.',
    example: input.example,
    tip: input.tip,
  };
}

/* ---------------------------------------------------------------------------
 * The six guides
 * ------------------------------------------------------------------------ */

export const ACCOUNT_GUIDES: readonly AccountGuide[] = [
  {
    role: RoleName.FLEET_OWNER,
    icon: Truck,
    title: 'Fleet owner',
    tagline: 'I own trucks and want to manage my fleet and win loads.',
    chooseIf: [
      'You own or operate trucks — one, or a hundred.',
      'You want to see where your vehicles are and what each trip earned.',
      'You want to bid on the loads customers post.',
    ],
    creates: 'A fleet organization, with you as its administrator.',
    minutes: 4,
    prepare: [
      {
        label: 'Your company name',
        detail: 'Spelled as it should appear on your bids and invoices.',
        required: true,
      },
      {
        label: 'A working mobile number and email address',
        detail: 'Both are used to reach you about trips and orders.',
        required: true,
      },
      {
        label: 'Your company logo',
        detail: 'Any image up to 5 MB. Skippable — it can be added later from settings.',
        required: false,
      },
    ],
    unlocks: [
      'Add trucks, drivers and documents to your fleet',
      'Generate invite codes so your drivers can join you',
      'Bid on marketplace loads and run the trips you win',
      'Live tracking, trip expenses and driver duty records',
    ],
    questions: [
      NAME_QUESTION,
      EMAIL_QUESTION,
      PHONE_QUESTION,
      organizationQuestion({
        label: 'Company',
        question: 'What is your transport business called?',
        help: 'The name your customers know you by. It appears on your bids, trip sheets and invoices.',
        example: 'Sharma Transport Company',
        tip: 'Registering a business you already run? Use its legal name — matching it now saves reconciling paperwork later.',
      }),
      LOGO_QUESTION,
      PASSWORD_QUESTION,
    ],
  },

  {
    role: RoleName.CUSTOMER,
    icon: ShoppingCart,
    title: 'Customer',
    tagline: 'I need materials, transport, a cab or a tour, and want offers to compare.',
    chooseIf: [
      'You need goods moved, or materials delivered to a site.',
      'You want to book a cab, a bus or a tour package.',
      'You would rather post what you need and compare the offers that come back.',
    ],
    creates:
      'A customer account. Name a company and Saarthi creates that organization; leave it blank and the account simply carries your own name.',
    minutes: 3,
    prepare: [
      {
        label: 'A working mobile number and email address',
        detail: 'Where quotes, booking confirmations and delivery updates arrive.',
        required: true,
      },
      {
        label: 'Your company name',
        detail:
          'Only if you buy on behalf of a business. Booking for yourself? You will be able to skip it.',
        required: false,
      },
      {
        label: 'A profile photo',
        detail: 'Optional, and changeable later from your profile.',
        required: false,
      },
    ],
    unlocks: [
      'Post a requirement and collect competing quotes',
      'Order materials from suppliers on the marketplace',
      'Book cabs, buses and tour packages',
      'Track every order and trip you have placed, in one list',
    ],
    questions: [
      NAME_QUESTION,
      EMAIL_QUESTION,
      PHONE_QUESTION,
      PHOTO_QUESTION,
      {
        id: 'organization',
        fields: ['organizationName'],
        icon: Building2,
        label: 'Company',
        question: 'Are you buying for a company?',
        help: 'Name it if your orders should carry a company name. Buying for yourself? Skip this — Saarthi names the account after you and nothing at all is withheld from an individual customer.',
        rule: 'Up to 160 characters.',
        example: 'Kumar Constructions',
        optional: true,
      },
      PASSWORD_QUESTION,
    ],
  },

  {
    role: RoleName.SUPPLIER,
    icon: Package,
    title: 'Supplier',
    tagline: 'I sell materials and arrange dispatch from my yard.',
    chooseIf: [
      'You sell cement, steel, sand, aggregate — anything by the load.',
      'You want buyers to find your catalogue and order from it.',
      'You dispatch from a yard and need the delivery tracked.',
    ],
    creates: 'A supplier organization with a catalogue and a yard, with you as its administrator.',
    minutes: 4,
    prepare: [
      {
        label: 'Your business name',
        detail: 'As it should appear on your listings and invoices.',
        required: true,
      },
      {
        label: 'A working mobile number and email address',
        detail: 'Where orders and dispatch requests reach you.',
        required: true,
      },
      {
        label: 'Your business logo',
        detail: 'Shown beside every product you list. Optional.',
        required: false,
      },
    ],
    unlocks: [
      'List materials with prices, units and stock',
      'Receive and confirm orders from customers',
      'Arrange dispatch and hand the load to a carrier',
      'Track what has been ordered, dispatched and paid',
    ],
    questions: [
      NAME_QUESTION,
      EMAIL_QUESTION,
      PHONE_QUESTION,
      organizationQuestion({
        label: 'Business',
        question: 'What is your supply business called?',
        help: 'The name buyers see on every listing and order. Use the one on your board and your bills.',
        example: 'Kumar Building Materials',
        tip: 'Your catalogue and yard are set up under this organization, so a name buyers recognise is worth a moment here.',
      }),
      LOGO_QUESTION,
      PASSWORD_QUESTION,
    ],
  },

  {
    role: RoleName.MOBILITY_PROVIDER,
    icon: Plane,
    title: 'Travel & tour operator',
    tagline: 'I run taxis, buses or tour packages and sell passenger journeys.',
    chooseIf: [
      'You run taxis, cabs, buses or tempo travellers.',
      'You sell tour packages with an itinerary and a price.',
      'Your drivers should sign on to a travel business, not to a freight fleet.',
    ],
    creates:
      'A travel business, with you as its administrator — the only account type that can publish tour packages.',
    minutes: 4,
    prepare: [
      {
        label: 'Your travel business name',
        detail: 'As it should appear on packages and booking confirmations.',
        required: true,
      },
      {
        label: 'A working mobile number and email address',
        detail: 'Where bookings and passenger enquiries arrive.',
        required: true,
      },
      {
        label: 'Your business logo',
        detail: 'Shown on your packages in the travel marketplace. Optional.',
        required: false,
      },
    ],
    unlocks: [
      'Publish tour packages with itineraries, seats and pricing',
      'Take cab and bus bookings from customers',
      'Add your vehicles and invite your own drivers',
      'Track every booking, journey and payment in one place',
    ],
    questions: [
      NAME_QUESTION,
      EMAIL_QUESTION,
      PHONE_QUESTION,
      organizationQuestion({
        label: 'Travel business',
        question: 'What is your travel business called?',
        help: 'The name passengers book with. It appears on every package and confirmation.',
        example: 'Sharma Travels & Tours',
        tip: 'Your drivers join this business with an invite code you generate afterwards — the same way a freight fleet invites its own.',
      }),
      LOGO_QUESTION,
      PASSWORD_QUESTION,
    ],
  },

  {
    role: RoleName.ASSOCIATION_ADMIN,
    icon: HandshakeIcon,
    title: 'Truck association',
    tagline: 'I represent a district association coordinating roadside help.',
    chooseIf: [
      'You hold office in a district or state truck association.',
      'You coordinate roadside help and breakdown response for member fleets.',
      'You need the emergency queue that dispatches help to a stranded driver.',
    ],
    creates:
      'An association, with you as its administrator — the only account type that runs an emergency queue.',
    minutes: 4,
    prepare: [
      {
        label: 'The association name',
        detail: 'The registered name, including the district it covers.',
        required: true,
      },
      {
        label: 'A working mobile number and email address',
        detail: 'Emergency escalations reach the association through these.',
        required: true,
      },
      {
        label: 'The association logo or emblem',
        detail: 'Shown to members and to drivers raising an SOS. Optional.',
        required: false,
      },
    ],
    unlocks: [
      'Run the emergency queue and dispatch roadside help',
      'Enrol member fleets and see their vehicles on the map',
      'Coordinate breakdown response across the district',
      'Publish notices that reach every member',
    ],
    questions: [
      NAME_QUESTION,
      EMAIL_QUESTION,
      PHONE_QUESTION,
      organizationQuestion({
        label: 'Association',
        question: 'What is your association called?',
        help: 'The registered name members know. Naming the district makes it findable for a driver looking for help nearby.',
        example: 'Jaipur District Truck Association',
        tip: 'Register the association itself, not your own transport business — if you run both, those are two separate accounts.',
      }),
      LOGO_QUESTION,
      PASSWORD_QUESTION,
    ],
  },

  {
    role: RoleName.DRIVER,
    icon: IdCard,
    title: 'Driver',
    tagline: 'I drive for a fleet that already uses Saarthi.',
    chooseIf: [
      'Your employer already uses Saarthi and has given you a code.',
      'You want your trips, duty hours and documents on your own phone.',
      'You want the SOS button that reaches nearby Saarthi trucks.',
    ],
    creates:
      'A driver profile inside your employer’s existing fleet. No company is created — you are joining one.',
    minutes: 3,
    prepare: [
      {
        label: 'Your fleet invite code',
        detail:
          'Six characters after SR-, generated by your truck owner in their own Saarthi account. You cannot finish without it.',
        required: true,
      },
      {
        label: 'Your driving licence number',
        detail: 'Read it off the licence itself rather than from memory.',
        required: true,
      },
      {
        label: 'A working mobile number and email address',
        detail: 'Where trip assignments and alerts reach you.',
        required: true,
      },
      {
        label: 'A profile photo',
        detail: 'Shown to your fleet owner and on your driver profile. Optional.',
        required: false,
      },
    ],
    unlocks: [
      'See the trips assigned to you and start them from your phone',
      'One-tap SOS that reaches nearby Saarthi trucks',
      'Your licence and documents in one place, with expiry reminders',
      'Duty hours, trip expenses and your driving score',
    ],
    questions: [
      NAME_QUESTION,
      EMAIL_QUESTION,
      PHONE_QUESTION,
      PHOTO_QUESTION,
      {
        id: 'fleet-code',
        fields: ['fleetInviteCode'],
        icon: Ticket,
        label: 'Invite code',
        question: 'What is your fleet invite code?',
        help: 'The code that connects you to your employer. Your truck owner generates it inside their own Saarthi account and sends it to you. Upper or lower case, it does not matter.',
        example: 'SR-4K9P2M',
        warning:
          'No code yet? Stop here and ask your fleet owner for one. This cannot be skipped, and a code from a business that does not run vehicles will be rejected when you finish.',
      },
      {
        id: 'licence',
        fields: ['licenseNumber'],
        icon: IdCard,
        label: 'Licence',
        question: 'What is your driving licence number?',
        help: 'Exactly as printed on your licence, including the dashes. Read it off the licence rather than from memory — it is checked against your documents later.',
        rule: 'Up to 40 characters.',
        example: 'DL-1420-20100000000',
      },
      PASSWORD_QUESTION,
    ],
  },
];

/** The guide for one account type. Every registrable role has one. */
export function guideForRole(role: RegistrableRole): AccountGuide {
  // The fallback is unreachable by construction — `ACCOUNT_GUIDES` covers
  // `registrableRoleSchema` in full, and the test beside this file is what
  // keeps that true as roles are added.
  return ACCOUNT_GUIDES.find((guide) => guide.role === role) ?? (ACCOUNT_GUIDES[0] as AccountGuide);
}
