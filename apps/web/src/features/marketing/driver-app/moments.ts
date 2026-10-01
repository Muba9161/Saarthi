import {
  ClipboardCheck,
  FileCheck2,
  Fingerprint,
  Languages,
  ScanLine,
  Siren,
  type LucideIcon,
} from 'lucide-react';
import { APP_SCREEN } from '../imagery';

/**
 * One moment of a driver's shift, as Humsafar shows it.
 *
 * Every claim here is read off the screen it sits beside, captured from the
 * running app. Nothing describes a feature the screenshot does not show, so
 * the band cannot drift into promising what the app does not do.
 */
export interface DriverAppMoment {
  id: string;
  title: string;
  body: string;
  /** The fact the floating tag beside the phone repeats. */
  tag: string;
  tagIcon: LucideIcon;
  screen: string;
  /** What the screenshot shows, for a reader who cannot see it. */
  alt: string;
}

/** In the order a shift actually runs, from opening the app to the check post. */
export const DRIVER_APP_MOMENTS: readonly DriverAppMoment[] = [
  {
    id: 'welcome',
    title: 'Says hello in your language',
    body: 'Humsafar opens in English or हिन्दी and explains itself in three short cards before it asks for anything.',
    tag: 'English · हिन्दी',
    tagIcon: Languages,
    screen: APP_SCREEN.welcome,
    alt: 'Humsafar welcome screen reading "Scan. Get approved. Drive." with Sign in and Create an account buttons.',
  },
  {
    id: 'quick-login',
    title: 'In with one touch',
    body: 'Fingerprint, face or a four-digit PIN, so nobody types a password in a yard at five in the morning.',
    tag: 'Fingerprint, face or PIN',
    tagIcon: Fingerprint,
    screen: APP_SCREEN.quickLogin,
    alt: 'Quick Login screen offering fingerprint or face, or a 4-digit PIN.',
  },
  {
    id: 'approval',
    title: 'Scan the vehicle, get approved',
    body: 'Scan the Saarthi code on the door or type the number, send an arrival photo, and the fleet approves from the office. The screen moves on by itself the moment they do.',
    tag: 'Approved by your own fleet',
    tagIcon: ScanLine,
    screen: APP_SCREEN.approval,
    alt: 'Waiting for approval screen showing the vehicle number and a three-step timeline: scanned, waiting for your fleet, trip starts.',
  },
  {
    id: 'safety-check',
    title: 'Ten checks before the wheels turn',
    body: 'Tyres, lights, brakes and the rest, one card at a time. Checks that can stop a trip are marked, so nothing serious gets waved through.',
    tag: 'On record before the trip starts',
    tagIcon: ClipboardCheck,
    screen: APP_SCREEN.safetyCheck,
    alt: 'Pre-trip safety check at 5 of 10, asking whether the lights are good, need attention or are faulty.',
  },
  {
    id: 'on-shift',
    title: 'Live to the fleet, one tap from help',
    body: 'While the trip runs, Humsafar reports to the fleet, finds fuel, mechanics, tyres and parking by road distance, turns a photo into a fuel slip, and keeps SOS in reach.',
    tag: 'SOS always in reach',
    tagIcon: Siren,
    screen: APP_SCREEN.onShift,
    alt: 'Home screen during a trip: live tracking card for the vehicle, quick actions for nearby places, fuel slip, safety check and notices, and an SOS button.',
  },
  {
    id: 'papers',
    title: 'Papers that work without signal',
    body: 'RC, insurance, permit, fitness, PUC and licence are kept on the phone, so a check post with no signal is not a problem. Anything close to expiry is flagged early.',
    tag: 'Works offline',
    tagIcon: FileCheck2,
    screen: APP_SCREEN.papers,
    alt: 'Your papers screen listing permit, pollution certificate, insurance and fitness certificate with days left on each, and a warning that one needs attention.',
  },
];
