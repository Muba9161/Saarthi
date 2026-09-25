import { Permission } from '@saarthi/shared';

/**
 * Saarthi Mitra's built-in guide to the product.
 *
 * "How do I…" is answered from here rather than from the model's imagination:
 * every route below exists in the web app and every step names a real screen
 * or button, so Mitra cannot send somebody to a page that is not there. It is
 * also cheap — a topic is a lookup, not a model call.
 *
 * A topic is offered only to callers holding one of its permissions; an empty
 * list means everyone.
 */

export interface HelpTopic {
  title: string;
  /** Shown to the model as the topic's one-line description. */
  summary: string;
  permissions: Permission[];
  steps: string[];
  screen: { label: string; path: string };
}

export const HELP_TOPICS = {
  post_requirement: {
    title: 'Post a requirement',
    summary: 'Ask for material, freight, a cab or a tour and let businesses bid',
    permissions: [Permission.REQUIREMENTS_CREATE],
    steps: [
      'Open My requirements and choose Post a requirement.',
      'Pick what you need, then describe it in one line - Saarthi fills in the details it can read.',
      'Add the pickup and delivery points, the dates, and optionally a budget.',
      'Review and post. Businesses that can serve it are notified and start bidding.',
    ],
    screen: { label: 'Post a requirement', path: '/requirements/new' },
  },
  compare_bids: {
    title: 'Compare bids and award',
    summary: 'See the offers on a requirement and choose one',
    permissions: [Permission.REQUIREMENTS_MANAGE],
    steps: [
      'Open My requirements and choose the requirement.',
      'Compare the offers - price, vehicle, and what each price covers.',
      'Shortlist the ones you like, then award the best. The order and trip are created for you.',
    ],
    screen: { label: 'My requirements', path: '/requirements' },
  },
  bid_on_work: {
    title: 'Bid on customer work',
    summary: 'Find customer requirements near you and place a bid',
    permissions: [Permission.REQUIREMENTS_BID],
    steps: [
      'Open Bid on work to see requirements your business can serve.',
      'Choose one and press Bid. Name the vehicle you are offering and your price.',
      'For a material requirement, pick the seller listing you will source from - Saarthi ranks the best matches.',
    ],
    screen: { label: 'Bid on work', path: '/requirements/board' },
  },
  find_sellers: {
    title: 'Find sellers',
    summary: 'Browse seller listings to source material for a bid',
    permissions: [Permission.MATERIALS_READ],
    steps: [
      'Open Find sellers to see what sellers have in stock, and at what price.',
      'When you bid on a material requirement, the same listings appear ranked for that requirement.',
    ],
    screen: { label: 'Find sellers', path: '/browse' },
  },
  add_product: {
    title: 'Add a product to sell',
    summary: 'List something you sell so fleet owners can source it',
    permissions: [Permission.MATERIALS_MANAGE],
    steps: [
      'Open Products and choose Add product.',
      'Describe it in one line, with the price and stock if you like - Saarthi reads the rest.',
      'Fill in anything still missing, review, and publish.',
    ],
    screen: { label: 'Add a product', path: '/supplier/materials/new' },
  },
  add_truck: {
    title: 'Add a truck',
    summary: 'Register a vehicle in your fleet',
    permissions: [Permission.TRUCKS_CREATE],
    steps: [
      'Open Trucks and choose Add a truck.',
      'Enter the registration number - Saarthi can look up the RC details for you.',
      'If you are at your plan’s vehicle limit, add capacity from Billing & subscription first.',
    ],
    screen: { label: 'Trucks', path: '/fleet/trucks' },
  },
  add_driver: {
    title: 'Add a driver',
    summary: 'Add a driver and get them verified',
    permissions: [Permission.DRIVERS_MANAGE],
    steps: [
      'Open Drivers and choose Add a driver.',
      'Enter their details and licence number.',
      'Open the driver to complete their verification before assigning them a vehicle.',
    ],
    screen: { label: 'Drivers', path: '/fleet/drivers' },
  },
  verify_account: {
    title: 'Verify your account',
    summary: 'Complete identity and business verification',
    permissions: [Permission.VERIFICATION_READ],
    steps: [
      'Open Verification to see every step for your account and what is still pending.',
      'Complete each pending step. Some checks carry a small fee, shown before you pay.',
      'Business documents such as GST are added under Business documents.',
    ],
    screen: { label: 'Verification', path: '/verification' },
  },
  business_documents: {
    title: 'Add business documents',
    summary: 'Upload and verify GST and other business documents',
    permissions: [Permission.DOCUMENTS_UPLOAD],
    steps: [
      'Open Business documents.',
      'Add your GST registration and other documents the page asks for.',
    ],
    screen: { label: 'Business documents', path: '/settings/business-documents' },
  },
  connect_bank: {
    title: 'Connect a bank account',
    summary: 'Receive marketplace payments into your bank account',
    permissions: [Permission.PAYOUT_ACCOUNT_MANAGE],
    steps: [
      'Open Payouts & commission.',
      'Enter the account holder name, account number, IFSC and PAN.',
      'Saarthi verifies it with a small test deposit. Payments reach you only once it is verified.',
    ],
    screen: { label: 'Payouts & commission', path: '/settings/payouts' },
  },
  profile_setup: {
    title: 'Complete your profile',
    summary: 'Fill in your personal and business profile',
    permissions: [],
    steps: [
      'Open My profile to see your profile completion and what is still missing.',
      'Fill in each section. A complete profile is trusted more by the businesses you work with.',
    ],
    screen: { label: 'My profile', path: '/settings/profile' },
  },
  vehicle_capacity: {
    title: 'Add vehicle capacity (top-up)',
    summary: 'Buy room for more vehicles on your plan, or add a tracker',
    permissions: [Permission.SUBSCRIPTION_READ],
    steps: [
      'Open Billing & subscription.',
      'Under Vehicle capacity, add the number of vehicles you need. The price is shown before you pay.',
      'Trackers for live engine data are bought on the same page.',
    ],
    screen: { label: 'Billing & subscription', path: '/settings/subscription' },
  },
  track_deliveries: {
    title: 'Track a delivery',
    summary: 'See where a vehicle is on its trip',
    permissions: [Permission.TRACKING_READ],
    steps: [
      'Open Live map to see your vehicles, or open the trip or order to follow one delivery.',
    ],
    screen: { label: 'Live map', path: '/tracking' },
  },
  documents_and_costs: {
    title: 'Vehicle documents and costs',
    summary: 'Documents, fuel, EMIs and toll for your vehicles',
    permissions: [Permission.DOCUMENTS_READ],
    steps: [
      'Open Documents & costs.',
      'Switch between documents, fuel, EMIs and toll with the tabs at the top.',
    ],
    screen: { label: 'Documents & costs', path: '/fleet/documents' },
  },
  emergency: {
    title: 'Raise or follow an SOS',
    summary: 'Get help in an emergency',
    permissions: [Permission.SOS_READ],
    steps: [
      'Open SOS incidents to see and follow emergencies.',
      'In a real emergency, call 112 first - then use Saarthi to alert your network.',
    ],
    screen: { label: 'SOS incidents', path: '/sos' },
  },
  refer_and_earn: {
    title: 'Refer and earn',
    summary: 'Invite other businesses to Saarthi',
    permissions: [Permission.REFERRALS_CREATE],
    steps: ['Open Refer & earn and share your link.'],
    screen: { label: 'Refer & earn', path: '/referrals' },
  },
} as const satisfies Record<string, HelpTopic>;

export type HelpTopicKey = keyof typeof HELP_TOPICS;
export const HELP_TOPIC_KEYS = Object.keys(HELP_TOPICS) as [HelpTopicKey, ...HelpTopicKey[]];
