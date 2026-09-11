import {
  Bullets,
  Callout,
  DefinitionList,
  FactTable,
  LegalDocument,
  LegalLink,
  Mailto,
  Numbered,
  P,
  SubHeading,
  type LegalSectionSpec,
} from '@/features/legal/legal-chrome';
import {
  LEGAL_ENTITY,
  PRIVACY_VERSION,
  RETENTION,
  entityText,
  formatAddress,
  formatRetention,
} from '@/features/legal/legal-entity';

/**
 * Privacy Policy.
 *
 * Saarthi collects more, and more sensitive, personal data than a typical
 * business application: where a named person drove, how hard they braked,
 * their Aadhaar and PAN, their blood group and next of kin, the photographs
 * and video their vehicle recorded. Writing a vague policy over that would be
 * both useless to the reader and indefensible under the DPDP Act, so this one
 * is specific — it names the categories the database actually holds and the
 * retention periods the API actually enforces.
 *
 * The distinction the whole document turns on is who decides. For an account
 * holder's own identity and billing we are the Data Fiduciary. For the
 * operational records a fleet creates about its drivers and vehicles, the
 * fleet decides and we process on its instructions. A driver asking to have
 * their trip history erased has to be pointed at their employer, and a policy
 * that blurs this sends them to the wrong party and wastes their time.
 *
 * Retention figures come from `RETENTION` in `legal-entity.ts`, which mirrors
 * the API's `*_RETENTION_DAYS` settings. Change them together or this document
 * becomes a false statement.
 */

const ENTITY = entityText(LEGAL_ENTITY.name);

const SECTIONS: LegalSectionSpec[] = [
  {
    id: 'overview',
    title: 'What this policy covers',
    body: (
      <>
        <P>
          This policy explains what personal data VorldX Saarthi collects, why, who it is shared
          with, how long it is kept and what you can do about it. It applies to the web application
          at {LEGAL_ENTITY.website}, the Saarthi driver and terminal applications, the telematics
          devices enrolled on the Platform, and our public website.
        </P>
        <P>
          It is written for the Digital Personal Data Protection Act, 2023 and the Information
          Technology Act, 2000 together with the rules made under them. It forms part of our{' '}
          <LegalLink to="/terms">Terms of Service</LegalLink>.
        </P>
        <P>
          Saarthi is used by fleet operators, drivers, suppliers, customers, travel operators,
          service providers and truck associations, and not every section will apply to you. The
          sections on location and telemetry matter most if you drive; the sections on verification
          and sharing matter most if you run a business on the Platform.
        </P>
      </>
    ),
  },
  {
    id: 'who-decides',
    title: 'Who decides what happens to your data',
    body: (
      <>
        <P>
          Two different relationships run through the Platform, and your rights depend on which one
          you are in.
        </P>
        <DefinitionList
          items={[
            {
              term: 'We decide',
              text: 'For your account itself - your name, email, phone, password, sign-in history, subscription, invoices and support conversations - Saarthi is the Data Fiduciary. Address requests about this data to us.',
            },
            {
              term: 'Your organisation decides',
              text: 'For the operational records an organisation creates - vehicles, trips, positions, driver scores, documents uploaded against a driver, orders, checklists and the audit trail - the organisation is the Data Fiduciary and we process on its instructions as a Data Processor. Address requests about this data to that organisation first; we will help them answer.',
            },
          ]}
        />
        <Callout title="If you drive for a fleet">
          Your employer or the fleet you are engaged by decides what is recorded about your work and
          how long it is kept, in the same way it decides what is in your personnel file. We cannot
          delete a fleet&rsquo;s trip records at a driver&rsquo;s request, but we will pass your
          request on and tell you who to contact.
        </Callout>
      </>
    ),
  },
  {
    id: 'what-we-collect',
    title: 'What we collect',
    body: (
      <>
        <SubHeading>Information you give us</SubHeading>
        <FactTable
          head={['Category', 'What it includes']}
          rows={[
            [
              'Account',
              'Name, email address, phone number, password (stored only as a hash), profile photograph, language and theme preference.',
            ],
            [
              'Organisation',
              'Business name and type, addresses, GSTIN and other registration numbers, business documents, team members and the roles assigned to them.',
            ],
            [
              'Driver profile',
              'Driving licence number, class and expiry, years of experience, date of birth, blood group, emergency contact name and phone, residential address, and availability.',
            ],
            [
              'Identity documents',
              'Aadhaar, PAN, Voter ID and GSTIN submitted for verification, and the documents uploaded to support them.',
            ],
            [
              'Vehicles and compliance',
              'Registration numbers, chassis and engine details, insurance, permit, fitness and pollution certificates, maintenance and service records, fuel entries, loan and instalment details, FASTag account references.',
            ],
            [
              'Commercial records',
              'Requirements, bids, quotes, orders, consignment and delivery details, materials and stock, travel bookings, resale listings, ratings and reviews.',
            ],
            [
              'Content you upload',
              'Photographs, scanned documents, proof of delivery, inspection images, issue reports and any file attached to a record.',
            ],
            [
              'Communications',
              'Messages to support, questions put to the AI copilot, and notification preferences.',
            ],
          ]}
        />

        <SubHeading>Information collected automatically</SubHeading>
        <FactTable
          head={['Category', 'What it includes']}
          rows={[
            [
              'Location',
              'GPS position, speed, heading and accuracy reported by a vehicle tracker or by a driver application while it is reporting, together with the trail, stops and route those positions form.',
            ],
            [
              'Telemetry',
              'Engine and battery readings, fuel level, odometer, ignition state, diagnostic trouble codes, harsh braking, harsh acceleration, over-speeding and idling events, geofence entries and exits.',
            ],
            [
              'Video',
              'Where a camera is fitted and enabled, recorded clips and live streams from inside and around the vehicle.',
            ],
            [
              'Device',
              'Hardware identifiers of an enrolled tracker, firmware version, network type and signal quality, battery state, and the application version and platform of a phone or terminal.',
            ],
            [
              'Technical',
              'IP address, browser and operating system, timestamps, pages and features used, and errors encountered.',
            ],
            [
              'Security records',
              'Sign-in attempts, session records, QR code scans (including where and by whom a code was scanned), and an audit trail of significant actions taken in an organisation.',
            ],
          ]}
        />

        <SubHeading>Information from other sources</SubHeading>
        <Bullets
          items={[
            'Government-authorised registers, through a licensed verification partner, when an Aadhaar, PAN, Voter ID, GSTIN, driving licence or vehicle registration certificate is checked.',
            'Toll and FASTag operators, when you connect a tag account, for balance and transaction history.',
            'Vehicle service history and valuation sources used for resale listings.',
            'The organisation that created your account, when an employer or fleet enrols you.',
            'A salesperson or referral partner, when you were introduced to Saarthi through one.',
          ]}
        />
      </>
    ),
  },
  {
    id: 'why-we-use-it',
    title: 'Why we use it',
    body: (
      <>
        <P>We use personal data only for the purposes below.</P>
        <FactTable
          head={['Purpose', 'What it involves']}
          rows={[
            [
              'Running the Platform',
              'Creating and securing accounts, showing vehicles on a map, building trip histories, matching requirements to bids, issuing invoices and delivering notifications.',
            ],
            [
              'Safety',
              'Raising and routing SOS alerts to nearby drivers and associations, detecting incidents, and surfacing route hazards.',
            ],
            [
              'Compliance and verification',
              'Confirming licences, registrations and identity documents, tracking document expiry, and keeping the records an operator is required by law to hold.',
            ],
            [
              'Insight',
              'Calculating driver scores, cost and utilisation analytics, and generating answers and insights in the AI copilot from records your role may already see.',
            ],
            [
              'Support and security',
              'Answering your questions, investigating incidents, detecting fraud and abuse, and protecting the Platform and its users.',
            ],
            [
              'Legal obligations',
              'Meeting tax, accounting, transport and data protection requirements, and responding to lawful requests.',
            ],
            [
              'Improving the product',
              'Understanding which capabilities are used and where they fail, in aggregate. We do not use your operational records to train AI models.',
            ],
          ]}
        />
        <SubHeading>The basis we rely on</SubHeading>
        <Bullets
          items={[
            'Your consent, given at registration and, where a capability needs it, at the point of use - location permission on a phone, or submitting an identity document for verification. Consent can be withdrawn.',
            'Performance of the contract between us, for everything needed to give you the service you subscribed to.',
            'Certain legitimate uses recognised by the DPDP Act, including responding to a medical emergency or a threat to safety, and complying with the law.',
            "Your employer's or principal's lawful purpose, where they are the Data Fiduciary and we process on their instructions.",
          ]}
        />
      </>
    ),
  },
  {
    id: 'location',
    title: 'Location, telemetry and monitoring, in detail',
    body: (
      <>
        <P>
          Location is the most sensitive data on the Platform, so it is worth being exact about when
          it is collected.
        </P>
        <Numbered
          items={[
            'A vehicle with an enrolled tracker reports position while the tracker has power and network coverage, at the reporting interval its organisation has configured.',
            'A driver application reports position while the driver is signed in and on duty, or on an active trip, according to the permission granted on the phone and the settings of the organisation.',
            'An SOS raises a position at the moment it is triggered, and shares it with responders and with the association covering that area, so that somebody can reach you.',
            'Nearby searches send an approximate position to find fuel stations, service points and rest stops around you.',
          ]}
        />
        <P>
          Location permission can be withdrawn in your device settings at any time. Doing so stops
          the driver application reporting, and with it live tracking, automatic trip detection, SOS
          location and nearby search. A tracker fitted to a vehicle reports independently of the
          phone and is controlled by the organisation that enrolled it.
        </P>
        <Callout tone="warning" title="Monitoring at work">
          Where an organisation tracks its vehicles and scores its drivers, that organisation
          decides what is monitored and is responsible for telling the people concerned. If you were
          not told what your employer records about your driving, ask them; we can tell you what
          categories the Platform is capable of holding, which is what this section does.
        </Callout>
      </>
    ),
  },
  {
    id: 'verification-data',
    title: 'How identity documents are handled',
    body: (
      <>
        <P>
          Identity numbers get specific treatment, because the harm from mishandling them is
          specific.
        </P>
        <Bullets
          items={[
            'A number submitted for verification is sent to the government-authorised source through our licensed verification partner, over an encrypted connection.',
            'The result is stored with the number encrypted using AES-256-GCM, alongside a one-way HMAC-SHA256 fingerprint used to recognise a repeat check without decrypting anything.',
            'A masked form - for example XXXX XXXX 9012 - is what the Platform displays. A full Aadhaar number is never shown back to a user, and only the last four digits are kept on the driver record.',
            'PAN is kept in full on the driver record, because it is routinely printed on invoices and payslips and is needed for compliance queries.',
            'Verification results are visible only to the organisation that ran the check and to the person the document belongs to, subject to their role.',
            'Verification requests are rate limited per user and recorded in the audit trail.',
          ]}
        />
        <P>
          Stored verification records are swept automatically after{' '}
          {formatRetention(RETENTION.identityVerificationDays)}, and cached register responses for
          vehicles and driving licences after {formatRetention(RETENTION.vehicleLookupDays)}. See{' '}
          <LegalLink to="/privacy#retention">retention</LegalLink> below.
        </P>
      </>
    ),
  },
  {
    id: 'sharing',
    title: 'Who your data is shared with',
    body: (
      <>
        <P>
          <strong className="font-medium text-foreground">
            We do not sell personal data, and we do not share it for advertising.
          </strong>{' '}
          It is disclosed only as described here.
        </P>
        <SubHeading>Within the Platform</SubHeading>
        <Bullets
          items={[
            'Your organisation. Administrators and colleagues see records according to the roles configured for them.',
            'The other side of a transaction. When you post a requirement, accept a bid, place an order or make a booking, the counterparty sees the contact and operational details needed to carry it out - not your full account.',
            'Associations and responders, when an SOS is raised in an area they cover.',
            'People who scan a QR code, to the extent your organisation has allowed - see the section below.',
          ]}
        />
        <SubHeading>Service providers acting for us</SubHeading>
        <P>
          These process data on our instructions, under contract, and only for the purpose they were
          engaged for:
        </P>
        <FactTable
          head={['Kind of provider', 'What they receive']}
          rows={[
            [
              'Cloud hosting and storage',
              'The Platform and its database, including uploaded documents and media.',
            ],
            [
              'Identity and registration verification',
              'The number being checked and the minimum context needed to check it.',
            ],
            [
              'Maps, routing and places',
              'Coordinates and search areas needed to draw a map, plan a route or find nearby services. Open map data sources receive an area, not an identity.',
            ],
            [
              'Toll and FASTag operators',
              'The tag or vehicle reference needed to read balance and transactions.',
            ],
            [
              'Payments',
              'The amount, reference and the details the processor needs to take a payment. We do not store full card details.',
            ],
            [
              'Communications',
              'Contact details needed to deliver an email, SMS or push notification.',
            ],
            [
              'AI model providers',
              'The question asked and the pre-authorised context assembled for it - see the AI section below.',
            ],
          ]}
        />
        <P>
          A current list of the providers we use is available on request from{' '}
          <Mailto address={LEGAL_ENTITY.email.privacy} />.
        </P>
        <SubHeading>Otherwise</SubHeading>
        <Bullets
          items={[
            'Where we are required to disclose by law, by a court, or by a competent authority acting under lawful process.',
            'Where it is necessary to protect life or safety, including in response to an emergency.',
            'To professional advisers, auditors and insurers under a duty of confidence.',
            'To a successor entity in a merger, acquisition or sale of the business, under the same protections as this policy. We will tell you if this happens.',
          ]}
        />
      </>
    ),
  },
  {
    id: 'public',
    title: 'What can become visible outside the Platform',
    body: (
      <>
        <P>
          Some things are designed to be seen by people without a Saarthi account. Know which they
          are.
        </P>
        <Bullets
          items={[
            'QR codes. A code printed on a vehicle or a document can be scanned by anybody holding it. The organisation decides which fields a scan reveals and whether anonymous scanning is allowed at all. Home address, chassis number and loan amounts can never be revealed this way.',
            'Listings. A requirement, material, travel package or vehicle offered for sale is shown to the businesses that can bid on or buy it, along with the contact details needed to respond.',
            'Profiles. Organisation and user profiles have a visibility setting that controls how widely they are shown.',
            'Referral links. Opening a referral link tells us which salesperson or partner introduced you, and shows you their display name.',
            'Ratings and reviews you leave are shown with your display name against the business you rated.',
          ]}
        />
        <P>Every scan of a QR code is logged, including the result and the purpose given for it.</P>
      </>
    ),
  },
  {
    id: 'ai',
    title: 'AI processing',
    body: (
      <>
        <P>
          When you ask the Saarthi copilot a question, the question and a context object assembled
          by the permission layer are sent to a large language model provider. The context contains
          only records your role is already allowed to see. The model has no access to the database,
          no tools, and no ability to widen its own scope.
        </P>
        <Bullets
          items={[
            'Depending on configuration, the provider is Anthropic or Google. Both are contractually bound not to train their models on data sent through their business interfaces.',
            'Conversations, the insights generated from them and usage counts are stored against your organisation so that a thread can be continued and usage metered.',
            'We do not use your operational records to train our own or anybody else’s models.',
            'Do not put information into the copilot that you are not entitled to process.',
          ]}
        />
        <P>
          AI answers can be wrong. Verify anything you intend to act on, as set out in the{' '}
          <LegalLink to="/terms#ai">Terms of Service</LegalLink>.
        </P>
      </>
    ),
  },
  {
    id: 'cookies',
    title: 'Cookies and local storage',
    body: (
      <>
        <P>
          Saarthi uses the minimum a signed-in application needs. There is no advertising or
          cross-site tracking on this Platform, and no third-party marketing cookie.
        </P>
        <FactTable
          head={['What', 'Why', 'Kind']}
          rows={[
            [
              'Session cookie',
              'Holds the refresh token that keeps you signed in. Set httpOnly and SameSite, so it is never readable by a script.',
              'Strictly necessary',
            ],
            [
              'Access token',
              'Held in memory for the life of the tab and sent with each request to authenticate it.',
              'Strictly necessary',
            ],
            [
              'Theme and language',
              'Remembers whether you chose light or dark and which language you read in, so the first screen paints correctly.',
              'Preference, stored in your browser',
            ],
            [
              'View preferences',
              'Remembers your choice of list or map view on screens that offer both.',
              'Preference, stored in your browser',
            ],
          ]}
        />
        <P>
          Clearing your browser storage signs you out and resets these preferences. Blocking the
          session cookie prevents sign-in from working at all.
        </P>
      </>
    ),
  },
  {
    id: 'transfers',
    title: 'Where your data is processed',
    body: (
      <P>
        We host and process personal data in India wherever we can. A small number of the services
        described above - in particular AI model providers and some map and routing services -
        process data outside India. Where that happens we rely on contractual protections with those
        providers, share only the minimum needed, and do not transfer to any territory restricted by
        the Central Government under the Digital Personal Data Protection Act, 2023.
      </P>
    ),
  },
  {
    id: 'retention',
    title: 'How long we keep things',
    body: (
      <>
        <P>
          We keep personal data for as long as the account or the record is live, and then for the
          periods below.
        </P>
        <FactTable
          head={['What', 'How long', 'Why']}
          rows={[
            [
              'Account details',
              'While the account is open, then up to 90 days after closure',
              'So an account closed by mistake can be restored.',
            ],
            [
              'Operational records of an organisation',
              'Decided by the organisation, subject to its own obligations',
              'Trips, documents, orders and compliance records are the organisation’s to keep.',
            ],
            [
              'Identity verification records',
              formatRetention(RETENTION.identityVerificationDays),
              'Swept automatically after this period.',
            ],
            [
              'Vehicle registration lookups',
              formatRetention(RETENTION.vehicleLookupDays),
              'Cached register responses, then removed.',
            ],
            [
              'Driving licence lookups',
              formatRetention(RETENTION.licenceLookupDays),
              'Cached register responses, then removed.',
            ],
            [
              'Invoices, payments and tax records',
              '8 years',
              'Required under Indian tax and company law.',
            ],
            [
              'Security and audit logs',
              'Up to 180 days, or longer where an investigation requires it',
              'Investigating incidents and meeting legal requirements.',
            ],
            [
              'Backups',
              'Up to 35 days after deletion from the live system',
              'Backups expire on their own cycle after a record is deleted.',
            ],
          ]}
        />
        <P>
          Where we are required to keep something longer, or need it to establish or defend a legal
          claim, we keep only that and restrict access to it.
        </P>
      </>
    ),
  },
  {
    id: 'security',
    title: 'How we protect it',
    body: (
      <>
        <Bullets
          items={[
            'Traffic is encrypted in transit. Passwords are stored only as bcrypt hashes and are never recoverable, by us or by anybody else.',
            'Sessions use short-lived access tokens with a refresh token held in an httpOnly, SameSite cookie, so a script on a page cannot read it.',
            'Identity numbers are encrypted at rest with AES-256-GCM and fingerprinted with HMAC-SHA256; masked forms are what the interface shows.',
            'Every organisation’s data is isolated, and access within an organisation is decided by role. The server enforces this on every request rather than trusting the application.',
            'Sign-ins, verification calls and other sensitive endpoints are rate limited, and significant actions are written to an audit trail.',
            'Uploaded files are size limited, type checked and served through the Platform rather than from a public directory.',
          ]}
        />
        <P>
          No system is perfectly secure. If we become aware of a personal data breach affecting you,
          we will notify you and the Data Protection Board of India as the DPDP Act requires. Tell
          us immediately at <Mailto address={LEGAL_ENTITY.email.privacy} /> if you think your
          account has been compromised.
        </P>
      </>
    ),
  },
  {
    id: 'your-rights',
    title: 'Your rights',
    body: (
      <>
        <P>Under the Digital Personal Data Protection Act, 2023 you have the right to:</P>
        <Bullets
          items={[
            'Ask what personal data of yours we hold and who it has been shared with.',
            'Have inaccurate or incomplete data corrected, and outdated data updated.',
            'Ask for erasure, where we no longer need the data and no law requires us to keep it.',
            'Withdraw consent you gave, as easily as you gave it. Withdrawing consent does not undo processing already carried out, and may stop parts of the Platform working.',
            'Nominate another person to exercise your rights if you die or become incapacitated.',
            'Complain to our Grievance Officer, and then to the Data Protection Board of India if you are not satisfied.',
          ]}
        />
        <P>
          To exercise any of these, write to <Mailto address={LEGAL_ENTITY.email.privacy} /> from
          the address on your account. We will respond within 30 days. We may ask you to confirm
          your identity first, which protects you rather than us.
        </P>
        <Callout title="Data your organisation controls">
          If your request concerns records an organisation created about you - trips, scores,
          documents in your personnel file - it has to be made to that organisation, which decides
          those. Write to us anyway if you are unsure and we will tell you who to ask.
        </Callout>
        <P>
          You are also expected, under the same Act, not to make a false or frivolous complaint and
          not to give false particulars about yourself.
        </P>
      </>
    ),
  },
  {
    id: 'children',
    title: 'Children',
    body: (
      <P>
        Saarthi is a business platform and is not intended for anybody under 18. We do not knowingly
        collect data from children. If you believe a child has given us personal data, write to{' '}
        <Mailto address={LEGAL_ENTITY.email.privacy} /> and we will delete it.
      </P>
    ),
  },
  {
    id: 'changes',
    title: 'Changes to this policy',
    body: (
      <P>
        We update this policy as the Platform changes. The version and effective date at the top of
        this page always show what is in force. Where a change materially affects how your personal
        data is used we will give notice in the Platform or by email before it takes effect.
      </P>
    ),
  },
  {
    id: 'grievance',
    title: 'Grievance Officer and contact',
    body: (
      <>
        <P>
          For any question or complaint about privacy, write to our Grievance Officer, appointed
          under the Digital Personal Data Protection Act, 2023 and the Information Technology
          (Intermediary Guidelines) Rules, 2021. Complaints are acknowledged within 24 hours and
          resolved within 15 days.
        </P>
        <FactTable
          head={['', 'Detail']}
          rows={[
            ['Entity', ENTITY],
            ['Grievance Officer', entityText(LEGAL_ENTITY.grievanceOfficer.name)],
            ['Email', <Mailto key="grievance" address={LEGAL_ENTITY.email.grievance} />],
            ['Privacy queries', <Mailto key="privacy" address={LEGAL_ENTITY.email.privacy} />],
            ['Telephone', entityText(LEGAL_ENTITY.phone)],
            ['Registered office', formatAddress(LEGAL_ENTITY.registeredOffice)],
          ]}
        />
        <P>
          If we do not resolve your complaint to your satisfaction, you may escalate it to the Data
          Protection Board of India.
        </P>
      </>
    ),
  },
];

export function PrivacyPage() {
  return (
    <LegalDocument
      eyebrow="Legal"
      title="Privacy Policy"
      summary="What Saarthi collects about you and your vehicles, why, who sees it, how long it is kept, and how to get it changed or removed."
      version={PRIVACY_VERSION}
      sections={SECTIONS}
      related={{ to: '/terms', label: 'Read the Terms of Service' }}
    />
  );
}

export default PrivacyPage;
