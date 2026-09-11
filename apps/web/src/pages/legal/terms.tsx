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
  TERMS_VERSION,
  entityText,
  formatAddress,
} from '@/features/legal/legal-entity';

/**
 * Terms of Service.
 *
 * Written against what Saarthi actually does rather than from a template, and
 * that is the point of it. The platform is not one product: it is a fleet
 * system, a freight and materials marketplace, a travel booking desk, a
 * vehicle resale listing service, a telematics hardware business and an
 * emergency network, and each of those creates a different obligation. A
 * generic SaaS agreement would say nothing about who is liable when a bid is
 * accepted, whether a tracker is sold or lent, or what happens when an SOS
 * goes unanswered — which are the three questions most likely to be asked.
 *
 * Three positions run through the whole document and are worth stating once
 * here, because every section is an application of one of them:
 *
 *   1. For transactions between users — freight, materials, travel, resale —
 *      Saarthi is the venue and not a party. The contract is between the two
 *      businesses; we carry the record of it.
 *   2. For anything derived rather than measured — estimated fuel, projected
 *      arrival, a licence register's answer, an AI reply — the platform
 *      reports and does not warrant. The product itself draws that line in
 *      its own copy, and the agreement has to draw the same one.
 *   3. Safety features assist and never replace. The SOS network reaches
 *      nearby drivers; 112 reaches an ambulance.
 *
 * Company facts come from `legal-entity.ts`. Do not inline them here: they
 * appear in both documents, and two copies of a registered address is one
 * copy too many.
 */

const ENTITY = entityText(LEGAL_ENTITY.name);
const COURTS = `${entityText(LEGAL_ENTITY.jurisdiction.city)}, ${entityText(
  LEGAL_ENTITY.jurisdiction.state,
)}`;

const SECTIONS: LegalSectionSpec[] = [
  {
    id: 'agreement',
    title: 'The agreement you are entering into',
    body: (
      <>
        <P>
          These Terms of Service govern your use of VorldX Saarthi - the web application at{' '}
          {LEGAL_ENTITY.website}, the Saarthi driver and terminal applications, the telematics
          devices and trackers supplied with them, and the interfaces and services behind all of it
          (together, the Platform). The Platform is operated by {ENTITY} (referred to here as
          Saarthi, we, us or our).
        </P>
        <P>
          You accept these terms when you tick the agreement box during registration, when you sign
          in to an account created for you by an organisation, or when you use any part of the
          Platform. If you do not accept them, do not use the Platform.
        </P>
        <P>
          If you are accepting on behalf of a company, partnership, association or sole
          proprietorship, you confirm that you are authorised to bind it, and these terms bind that
          entity as well as you personally.
        </P>
        <P>
          These terms should be read with our <LegalLink to="/privacy">Privacy Policy</LegalLink>,
          which forms part of this agreement and explains what we do with the information the
          Platform holds.
        </P>
      </>
    ),
  },
  {
    id: 'definitions',
    title: 'Definitions',
    body: (
      <DefinitionList
        items={[
          {
            term: 'Account',
            text: 'The individual login issued to a person, identified by their email address or phone number.',
          },
          {
            term: 'Organisation',
            text: 'The business or body an account belongs to - a fleet operator, supplier, customer, travel operator, service provider or truck association. Records created inside an organisation belong to that organisation, not to the individual who entered them.',
          },
          {
            term: 'Administrator',
            text: 'A member of an organisation holding permissions to invite users, assign roles, configure privacy settings and manage the subscription.',
          },
          {
            term: 'Driver User',
            text: 'A person holding a driver account, whether employed by an organisation, engaged by it, or operating their own vehicle.',
          },
          {
            term: 'Subscription',
            text: 'The plan, vehicle count and add-ons an organisation has purchased, which determines the capabilities available to it.',
          },
          {
            term: 'Device',
            text: 'A telematics unit, tracker, dashcam or phone acting as a telemetry source, enrolled against an organisation.',
          },
          {
            term: 'Content',
            text: 'Anything you put into the Platform: records, documents, photographs, video, messages, listings, bids, ratings and location data.',
          },
          {
            term: 'Listing',
            text: 'A requirement, material offer, travel package, vehicle for resale, return load or bid published on the Platform by a user.',
          },
        ]}
      />
    ),
  },
  {
    id: 'eligibility',
    title: 'Eligibility and registration',
    body: (
      <>
        <P>To hold a Saarthi account you must:</P>
        <Bullets
          items={[
            'Be at least 18 years old and legally able to enter into a contract under the Indian Contract Act, 1872.',
            'Provide accurate registration details, and keep them current. A vehicle, licence or GST number that is wrong is not a neutral error on this Platform: it flows into compliance reminders, verification checks and documents other businesses rely on.',
            'Hold the licences, permits and registrations the law requires for the activity you are carrying out through the Platform, including a valid driving licence, fitness certificate, permit, pollution certificate and insurance where applicable.',
            'Not be barred from receiving services under any Indian law, or previously removed from the Platform by us.',
          ]}
        />
        <P>
          We may refuse or withdraw registration, and may require verification of your identity,
          your business or your vehicles before enabling parts of the Platform.
        </P>
      </>
    ),
  },
  {
    id: 'accounts',
    title: 'Accounts, organisations and access',
    body: (
      <>
        <P>
          You are responsible for everything done under your account. Keep your password private,
          use a device you control, and tell us immediately if you believe your account has been
          accessed by somebody else.
        </P>
        <SubHeading>What an administrator can see and do</SubHeading>
        <P>
          An organisation&rsquo;s administrators can see the operational records created inside that
          organisation, including trips, positions reported by assigned vehicles, driver scores,
          documents uploaded against a driver profile, and the audit trail of actions taken. If you
          hold an account issued by an employer or a fleet you drive for, you should assume the
          organisation can see your work activity on the Platform.
        </P>
        <P>
          Administrators are responsible for the roles they assign and for removing access when a
          person leaves. We act on the permissions an organisation configures; we do not adjudicate
          between an organisation and its staff.
        </P>
        <SubHeading>Accounts we create for you</SubHeading>
        <P>
          An organisation may create an account on your behalf, for example when a fleet enrols a
          driver. Using that account means accepting these terms. You may ask us to close an account
          created for you, although records created inside the organisation remain with the
          organisation.
        </P>
      </>
    ),
  },
  {
    id: 'subscriptions',
    title: 'Subscriptions, fees and taxes',
    body: (
      <>
        <P>
          Saarthi is sold by the vehicle. The plan you choose, the number of vehicles on it and any
          add-ons together determine your charge, and the prices in force are those shown on the
          pricing section of our site at the time you subscribe or renew.
        </P>
        <Bullets
          items={[
            <>
              <strong className="font-medium text-foreground">Trial.</strong> Where a free trial is
              offered, it runs for the period stated at sign-up. Unless you cancel before it ends,
              the subscription continues as a paid one.
            </>,
            <>
              <strong className="font-medium text-foreground">Billing period.</strong> Subscriptions
              are billed monthly or yearly in advance, as selected. Yearly billing carries the
              discount shown on the pricing page at the time of purchase.
            </>,
            <>
              <strong className="font-medium text-foreground">Taxes.</strong> Prices are exclusive
              of Goods and Services Tax unless stated otherwise. GST is charged at the applicable
              rate and shown separately on the invoice. You are responsible for giving us a correct
              GSTIN if you wish to claim input credit; we cannot reissue an invoice against a GSTIN
              supplied after the fact in every case.
            </>,
            <>
              <strong className="font-medium text-foreground">Adding vehicles.</strong> Adding a
              vehicle mid-period is charged pro rata for the remainder of that period, and in full
              from the next renewal.
            </>,
            <>
              <strong className="font-medium text-foreground">Renewal.</strong> Subscriptions renew
              automatically for a further period of the same length unless cancelled before the
              renewal date.
            </>,
            <>
              <strong className="font-medium text-foreground">Non-payment.</strong> If a payment
              fails we may restrict access to paid capabilities. Your records are retained for the
              period set out in the Privacy Policy so that a lapsed subscription can be restored
              rather than rebuilt.
            </>,
          ]}
        />
        <SubHeading>Cancellation and refunds</SubHeading>
        <P>
          You may cancel at any time, effective at the end of the period already paid for. Fees
          already paid are not refundable except where required by law, where we have withdrawn a
          capability you paid for and cannot offer a comparable replacement, or where we agree in
          writing. Hardware is dealt with separately below.
        </P>
      </>
    ),
  },
  {
    id: 'hardware',
    title: 'Trackers, telematics devices and dashcams',
    body: (
      <>
        <P>
          Hardware sold through Saarthi - GPS trackers, OBD telematics units and cameras - is
          charged once per unit and is yours on payment. Where a device is supplied on loan, that is
          stated at the point of sale and the device remains our property.
        </P>
        <Bullets
          items={[
            'Installation must follow the instructions supplied. A unit fitted incorrectly can report wrong data, drain a battery or interfere with a vehicle system, and we are not liable for the consequences of an installation we did not carry out.',
            'Telemetry requires mobile network coverage and power. Reporting stops when a vehicle is out of coverage, when the unit loses power, or when it is removed. Gaps in a trail are expected and are not by themselves evidence of anything.',
            'A device is enrolled against an organisation and authenticates as itself. Do not move a unit to a vehicle outside the organisation it is enrolled to without reassigning it in the Platform.',
            'Manufacturer warranty terms apply to the physical unit. A tracker that has been opened, immersed, rewired or physically damaged is outside it.',
            'Tampering with, disabling or spoofing a device in order to falsify a record is a serious breach of these terms and may end your access.',
          ]}
        />
        <P>
          Dashcam and live video capability, where enabled, records inside and around a vehicle. The
          organisation operating the vehicle is responsible for notifying drivers and passengers
          that recording takes place, and for using the footage only for the safety and operational
          purposes it was collected for.
        </P>
      </>
    ),
  },
  {
    id: 'tracking',
    title: 'Location tracking and driver monitoring',
    body: (
      <>
        <P>
          Live tracking is the heart of the Platform. When a vehicle is on trip, or when a driver
          application is reporting, Saarthi records position, speed, route, stops, harsh braking and
          acceleration events, idling and, where a telematics unit supplies them, engine and fuel
          readings. This produces the trip history, the driver score and the alerts the product is
          built on.
        </P>
        <Callout tone="warning" title="If you deploy tracking, the notice obligation is yours">
          An organisation that tracks vehicles and scores drivers is monitoring people at work. You
          are responsible for telling the drivers concerned what is collected, why, and who can see
          it, and for obtaining any consent your employment terms or applicable law require. Saarthi
          gives you the controls and the record; it cannot give the notice on your behalf.
        </Callout>
        <P>
          Driver scores are calculated from recorded events using the method described in the
          product. They are an operational indicator, not a certification of competence, and should
          not be the sole basis for a decision about somebody&rsquo;s employment.
        </P>
        <P>
          Arrival estimates, distance figures and any fuel figure not read from a sensor are
          calculated. The Platform marks estimated figures as estimated; do not treat an estimate as
          a measurement, and do not settle an account on one.
        </P>
      </>
    ),
  },
  {
    id: 'verification',
    title: 'Identity, licence and registration checks',
    body: (
      <>
        <P>
          Saarthi can verify an Aadhaar number, PAN, Voter ID, GSTIN, driving licence or vehicle
          registration certificate against the relevant government-authorised source through a
          licensed verification partner. By submitting a number for verification you confirm:
        </P>
        <Numbered
          items={[
            'That it is yours, or that the person it belongs to has consented to the check for the stated purpose.',
            'That you are running the check for a legitimate purpose connected with using the Platform - onboarding a driver, confirming a vehicle, or meeting a compliance obligation.',
            'That you will not run checks in bulk, on people you have no relationship with, or to build a database outside the Platform.',
          ]}
        />
        <P>
          We return what the source returns. A check that comes back negative, stale or unavailable
          is a statement about the register, not a judgement by us about a person, and we do not
          warrant the accuracy or currency of government records. Full Aadhaar numbers are never
          displayed back; only a masked form is shown. How verification data is stored and for how
          long is set out in the{' '}
          <LegalLink to="/privacy#verification-data">Privacy Policy</LegalLink>.
        </P>
        <P>
          Running a verification consumes a paid lookup. Repeated checks of the same subject within
          the caching window may be answered from the stored result rather than re-queried.
        </P>
      </>
    ),
  },
  {
    id: 'marketplace',
    title: 'Freight, materials and the requirement board',
    body: (
      <>
        <P>
          The marketplace lets a customer post a requirement and lets transporters, suppliers and
          service providers bid on it; it also carries orders, quotes, return loads and relay
          deliveries. Saarthi is the venue for these dealings, not a party to them.
        </P>
        <Bullets
          items={[
            'A contract formed when a bid or quote is accepted is between the two businesses concerned. We are not the shipper, the carrier, the consignor, the consignee, a freight forwarder, a broker or an agent of any of them.',
            'You are responsible for satisfying yourself about the other side - their licences, their insurance, their capacity and their creditworthiness. Verification badges show what has been checked on the Platform, which is not the same as a recommendation.',
            'Prices, quantities, materials, timelines, e-way bills, consignment notes and any other statutory documentation are yours to agree and to issue. Records held in Saarthi are a convenience and do not replace the documents the law requires you to carry.',
            'Payment between users, where it is not processed through the Platform, is settled directly between them. Non-payment, short payment and disputes about the quality of a load or a delivery are between the parties.',
            'Ratings and reviews must reflect a genuine dealing. We may remove a rating we believe to be fabricated, retaliatory or traded for.',
          ]}
        />
        <P>
          We may decline, suspend or remove a listing that appears unlawful, misleading, duplicated
          across accounts, or posted to manipulate the board.
        </P>
      </>
    ),
  },
  {
    id: 'travel',
    title: 'Travel packages and bookings',
    body: (
      <>
        <P>
          Where the Platform carries travel packages, vehicle hire or tour services, those services
          are provided by the travel operator or service provider who listed them. That operator is
          responsible for the itinerary, the vehicle, the driver, the permits and the conduct of the
          trip.
        </P>
        <Bullets
          items={[
            'Your booking contract is with the operator. Their own terms, including their cancellation policy, apply alongside these terms.',
            'Cancellation and refund outcomes follow the policy shown on the package at the time of booking, and the status the booking has reached.',
            'Where a payment is processed through the Platform, we pass it to the operator under our arrangement with them. A refund we process is limited to amounts actually received.',
            'Reviews may be left only by a customer who completed a booking.',
          ]}
        />
      </>
    ),
  },
  {
    id: 'resale',
    title: 'Vehicle resale listings',
    body: (
      <>
        <P>
          A vehicle listed for resale is sold by its owner. Saarthi publishes the listing, carries
          offers and inspection requests, and records the transfer; it does not buy, sell, value,
          inspect or guarantee any vehicle.
        </P>
        <Bullets
          items={[
            'A seller must own the vehicle or be authorised to sell it, must disclose known material defects, accident history and any outstanding loan or hypothecation, and must not misdescribe condition, ownership or running figures.',
            'Odometer readings, service history and condition grades shown on a listing come from the seller and from third-party history sources. Inspect before you buy.',
            'Transfer of registration, clearance of any charge on the vehicle, and payment of road tax and applicable duties are for the parties to complete with the relevant authority.',
            'A listing that misrepresents a vehicle may be removed and the account suspended.',
          ]}
        />
      </>
    ),
  },
  {
    id: 'finance',
    title: 'Loans, EMI tracking, FASTag and toll',
    body: (
      <>
        <P>
          Saarthi records vehicle loans, schedules instalments, sends repayment reminders and, where
          you connect a FASTag account, reads toll transactions and balances so they can be
          attributed to the right vehicle and trip.
        </P>
        <Callout tone="warning" title="This is bookkeeping, not financial services">
          Saarthi is not a bank, a non-banking financial company, a lender, a broker or a payment
          system operator, and nothing in the Platform is financial, tax, accounting or legal
          advice. We do not lend, collect, settle or guarantee any amount. A reminder is a
          convenience: your obligation to your lender is set by your loan agreement, and a missed
          reminder does not excuse a missed instalment.
        </Callout>
        <P>
          FASTag balances and toll transactions are read from the operator of that account. Figures
          may lag, may be adjusted by the operator afterwards, and are shown for operational and
          reconciliation purposes. Disputes about a toll deduction are between you and your tag
          issuer.
        </P>
      </>
    ),
  },
  {
    id: 'sos',
    title: 'Emergency SOS and the association network',
    body: (
      <>
        <Callout tone="warning" title="Saarthi is not an emergency service">
          The SOS feature alerts nearby Saarthi drivers and, where configured, a truck association
          that has chosen to receive alerts in that area. It does not summon police, an ambulance or
          the fire service. In any situation involving injury, fire, crime or immediate danger, call
          112 first. Use Saarthi in addition, never instead.
        </Callout>
        <P>
          An SOS depends on a working device, battery, mobile coverage, location permission and on
          other users being nearby, signed in and willing to respond. None of those can be
          guaranteed, and we do not guarantee that an alert will be seen, answered, answered in
          time, or answered by anybody competent to help.
        </P>
        <P>
          Responders are other users acting voluntarily. They are not our employees, agents or
          contractors, we do not train, supervise, vet or dispatch them, and we are not responsible
          for what they do or fail to do. If you respond to an alert, you do so at your own risk and
          judgement.
        </P>
        <P>
          Raising a false alarm, or using SOS for anything other than a genuine emergency, endangers
          the people who respond to the next one. It will end your access to the feature and may end
          your account.
        </P>
      </>
    ),
  },
  {
    id: 'ai',
    title: 'AI features',
    body: (
      <>
        <P>
          The Saarthi copilot answers questions about your own operation using records your role is
          permitted to see, and generates insights and summaries from them. Answers are produced by
          a language model and, like any such output, can be incomplete or wrong even when they read
          confidently.
        </P>
        <Bullets
          items={[
            'Treat an AI answer as a starting point. Verify anything you are going to act on against the underlying records, which the Platform links to.',
            'AI output is not legal, financial, tax, safety, medical or engineering advice, and must not be used as the sole basis for a decision affecting a person, a payment or a vehicle.',
            'Do not paste information into the copilot that you are not entitled to process, and do not use it to generate anything unlawful or misleading.',
            'Use is metered against your subscription and may be rate limited.',
          ]}
        />
        <P>
          How prompts and context are handled, including which providers process them, is described
          in the <LegalLink to="/privacy#ai">Privacy Policy</LegalLink>.
        </P>
      </>
    ),
  },
  {
    id: 'qr',
    title: 'QR codes and public disclosure',
    body: (
      <>
        <P>
          Saarthi can issue QR codes for vehicles, drivers, trips, orders and handovers. Some codes
          are designed to be scanned by people with no Saarthi account - an officer at a checkpoint,
          a supervisor at a loading bay, a customer at a gate - and will return the information the
          code&rsquo;s scope allows to whoever scans it.
        </P>
        <Callout title="You control what a code reveals">
          Each organisation sets its own QR privacy policy: which fields are disclosed, and whether
          anonymous scanning is permitted at all. Some fields, including home address, chassis
          number and loan amounts, can never be disclosed through a scan regardless of
          configuration. Review these settings before printing a sticker, and revoke a code that has
          been lost or misused.
        </Callout>
        <P>
          Every scan is logged. Scanning a code you were not given, or using data obtained from a
          scan for a purpose other than the one the scan was offered for, is a breach of these terms
          and may also breach data protection law.
        </P>
      </>
    ),
  },
  {
    id: 'your-content',
    title: 'Your content, and the permission you give us',
    body: (
      <>
        <P>
          Your content stays yours. You grant us a non-exclusive, worldwide, royalty-free licence to
          host, store, copy, transmit, display and process it strictly to the extent needed to run
          the Platform for you and the organisations you share it with, to keep backups, to meet a
          legal obligation, and to support and secure the service.
        </P>
        <P>
          That licence exists so the product can function - so a document uploaded on a phone can be
          read on a desktop, so a listing can be shown to a bidder, so a trip can be reconstructed
          for a dispute. It does not let us sell your data, and we do not.
        </P>
        <P>You confirm that content you upload:</P>
        <Bullets
          items={[
            'Is yours to upload, or that you have permission to upload it.',
            'Does not infringe anybody else’s rights.',
            'Does not contain another person’s sensitive personal information without their consent - this matters most for documents and photographs of people.',
            'Is not unlawful, fraudulent, obscene, defamatory or designed to deceive.',
          ]}
        />
        <P>
          Where an organisation has uploaded content about you, that organisation controls it. We
          may remove content that breaches these terms.
        </P>
      </>
    ),
  },
  {
    id: 'acceptable-use',
    title: 'Acceptable use',
    body: (
      <>
        <P>You must not:</P>
        <Bullets
          items={[
            'Use the Platform for anything unlawful, or to carry, arrange or conceal the carriage of prohibited goods.',
            'Impersonate another person or business, or misstate whose vehicle, licence or GSTIN you are using.',
            'Falsify a record - a location, a trip, a delivery confirmation, a checklist, an inspection, a document or a rating.',
            'Attempt to reach data belonging to another organisation, probe or bypass access controls, or test the security of the Platform without our written permission.',
            'Scrape, crawl, bulk-export or resell Platform data, or use another user’s contact details for marketing they did not ask for.',
            'Reverse engineer, decompile or copy the Platform or its applications, or build a competing service from it.',
            'Upload malware, overload the service, or interfere with its operation or with any device on it.',
            'Share an account, sell access, or use a single subscription across separate businesses.',
            'Use the Platform to stalk, harass or surveil a person outside a lawful employment or commercial relationship.',
          ]}
        />
        <P>
          Responsible security research is welcome. If you believe you have found a vulnerability,
          report it to <Mailto address={LEGAL_ENTITY.email.support} /> before doing anything else
          with it.
        </P>
      </>
    ),
  },
  {
    id: 'intellectual-property',
    title: 'Our intellectual property',
    body: (
      <>
        <P>
          The Platform, its software, applications, designs, documentation, database structure and
          the VorldX and Saarthi names and marks belong to us or to our licensors. Your subscription
          is a limited, revocable, non-exclusive, non-transferable right to use the Platform for
          your own business while it is in good standing. Nothing in these terms transfers ownership
          of anything.
        </P>
        <P>
          Feedback you send us may be used to improve the product without obligation to you, and
          without giving you any interest in what results.
        </P>
      </>
    ),
  },
  {
    id: 'third-parties',
    title: 'Third-party services and data sources',
    body: (
      <>
        <P>
          Saarthi is built on services we do not control, and parts of the product stop working when
          one of them does. These include government-authorised verification sources, map and
          routing data, points of interest from open map data, fuel price and petrol station
          sources, toll and FASTag operators, payment processors, cloud hosting and AI model
          providers.
        </P>
        <P>
          We choose these carefully, but we do not warrant data supplied by them. A road that does
          not exist, a station that has closed, a price that has moved and a register that is behind
          are all possible. Where a third party&rsquo;s own terms apply to what you do, those terms
          apply alongside these.
        </P>
      </>
    ),
  },
  {
    id: 'availability',
    title: 'Availability, changes and demonstration data',
    body: (
      <>
        <P>
          We work to keep the Platform available but do not promise uninterrupted service. Planned
          maintenance, emergency fixes, network failures and third-party outages all interrupt it.
          Unless a separate written service level agreement is in place with you, none is implied.
        </P>
        <P>
          We add, change and withdraw capabilities. Where a change materially reduces something you
          are paying for, we will give reasonable notice and, if we cannot offer a comparable
          replacement, a pro-rata refund for the unused period.
        </P>
        <P>
          Some parts of the Platform are marked as demonstration, simulation or preview. Data shown
          there is generated for illustration, does not describe real vehicles or real journeys, and
          must not be relied on or presented to a third party as real.
        </P>
      </>
    ),
  },
  {
    id: 'suspension',
    title: 'Suspension and termination',
    body: (
      <>
        <P>You may stop using the Platform at any time and may close your account from Settings.</P>
        <P>We may suspend or terminate access, in whole or in part, where:</P>
        <Bullets
          items={[
            'A subscription is unpaid after we have told you about it.',
            'These terms are breached, particularly the acceptable use and safety sections.',
            'We are required to by law, or by a court or competent authority.',
            'Continuing would present a security risk, or a risk to another user.',
          ]}
        />
        <P>
          Where the circumstances allow, we will give notice first and an opportunity to put the
          matter right. On termination your right to use the Platform ends. Export your records
          before you close an account; retention after closure is described in the{' '}
          <LegalLink to="/privacy#retention">Privacy Policy</LegalLink>, and records belonging to an
          organisation remain with that organisation.
        </P>
      </>
    ),
  },
  {
    id: 'disclaimers',
    title: 'Disclaimers',
    body: (
      <>
        <P>
          The Platform is provided on an as-is and as-available basis. To the fullest extent
          permitted by law, we exclude all warranties, conditions and representations not expressly
          set out in these terms, including any implied warranty of merchantability, fitness for a
          particular purpose, accuracy or non-infringement.
        </P>
        <P>In particular, we do not warrant that:</P>
        <Bullets
          items={[
            'Location, telemetry, arrival estimates, fuel figures or scores are accurate, complete or continuous.',
            'A government register, a toll operator or any other external source will be available, current or correct.',
            'An SOS alert will be delivered, seen or answered.',
            'A counterparty found through the Platform will perform, pay or behave lawfully.',
            'AI output is accurate or suitable for a particular decision.',
            'The Platform will be free of defects or available without interruption.',
          ]}
        />
      </>
    ),
  },
  {
    id: 'liability',
    title: 'Limitation of liability',
    body: (
      <>
        <P>
          Nothing in these terms limits liability that cannot lawfully be limited, including
          liability for death or personal injury caused by our negligence, or for fraud.
        </P>
        <P>Subject to that, and to the fullest extent permitted by law:</P>
        <Numbered
          items={[
            'We are not liable for indirect, incidental, special, punitive or consequential loss, or for loss of profit, revenue, business, goodwill, contracts, cargo or anticipated savings, however arising.',
            'We are not liable for loss arising from a transaction between users, from the acts or omissions of another user or of an SOS responder, from goods or vehicles carried, from a third-party data source, or from your failure to meet a statutory obligation of your own.',
            <>
              Our total aggregate liability for all claims in any twelve-month period is limited to
              the amount you actually paid us for the Platform in the twelve months before the event
              giving rise to the claim, or {'₹'}10,000, whichever is greater.
            </>,
          ]}
        />
        <P>
          These limits apply however the claim arises, whether in contract, tort, statute or
          otherwise, and survive termination.
        </P>
      </>
    ),
  },
  {
    id: 'indemnity',
    title: 'Indemnity',
    body: (
      <P>
        You will indemnify and hold us harmless against claims, losses, damages, penalties and
        reasonable legal costs arising from your use of the Platform, your content, your dealings
        with other users, your breach of these terms, or your breach of any law - including
        transport, tax, labour and data protection law. We will tell you promptly about a claim and
        will not settle it without consulting you.
      </P>
    ),
  },
  {
    id: 'governing-law',
    title: 'Governing law and disputes',
    body: (
      <>
        <P>
          These terms are governed by the laws of India. Subject to the paragraph below, the courts
          at {COURTS} have exclusive jurisdiction.
        </P>
        <P>
          Before starting proceedings, tell us about the dispute in writing at{' '}
          <Mailto address={LEGAL_ENTITY.email.legal} /> and give us thirty days to resolve it. Most
          disputes end there, and this step is a condition of bringing a claim except where urgent
          interim relief is needed.
        </P>
        <P>
          A dispute that is not resolved may be referred to arbitration by a sole arbitrator under
          the Arbitration and Conciliation Act, 1996. The seat and venue of arbitration is {COURTS},
          and the proceedings will be in English.
        </P>
      </>
    ),
  },
  {
    id: 'grievance',
    title: 'Grievance redressal',
    body: (
      <>
        <P>
          In accordance with the Information Technology Act, 2000 and the rules made under it, the
          details of our Grievance Officer are below. Complaints are acknowledged within 24 hours
          and resolved within 15 days of receipt.
        </P>
        <FactTable
          head={['', 'Detail']}
          rows={[
            ['Name', entityText(LEGAL_ENTITY.grievanceOfficer.name)],
            ['Designation', LEGAL_ENTITY.grievanceOfficer.designation],
            ['Email', <Mailto key="email" address={LEGAL_ENTITY.email.grievance} />],
            ['Address', formatAddress(LEGAL_ENTITY.registeredOffice)],
          ]}
        />
        <P>
          Complaints about personal data are handled under the{' '}
          <LegalLink to="/privacy#grievance">Privacy Policy</LegalLink>, which sets out your rights
          under the Digital Personal Data Protection Act, 2023.
        </P>
      </>
    ),
  },
  {
    id: 'changes',
    title: 'Changes to these terms',
    body: (
      <>
        <P>
          We may update these terms. The version and effective date at the top of this page always
          show what is currently in force.
        </P>
        <P>
          Where a change materially affects your rights or obligations we will give at least 14
          days&rsquo; notice by email or in the Platform before it takes effect. Continuing to use
          Saarthi after that date means accepting the updated terms. If you do not accept them, stop
          using the Platform and cancel your subscription before the date they take effect.
        </P>
      </>
    ),
  },
  {
    id: 'general',
    title: 'General',
    body: (
      <DefinitionList
        items={[
          {
            term: 'Entire agreement',
            text: 'These terms, the Privacy Policy and any order form or written agreement signed with us are the whole agreement between us on this subject.',
          },
          {
            term: 'Severability',
            text: 'If a provision is held unenforceable, the rest continues in force and the provision is read down to the minimum extent needed to make it enforceable.',
          },
          {
            term: 'No waiver',
            text: 'Not enforcing a provision on one occasion does not waive it.',
          },
          {
            term: 'Assignment',
            text: 'You may not assign this agreement without our written consent. We may assign it to a group company or to a successor in a merger or sale of the business.',
          },
          {
            term: 'Force majeure',
            text: 'Neither party is liable for failure caused by an event beyond its reasonable control, including natural disaster, epidemic, war, civil unrest, strike, network or power failure, or an act of government.',
          },
          {
            term: 'Notices',
            text: 'We give notice by email to the address on your account or in the Platform. You give notice to the addresses in the contact section below.',
          },
          {
            term: 'Relationship',
            text: 'Nothing here creates a partnership, joint venture, agency or employment relationship between us.',
          },
          {
            term: 'Language',
            text: 'These terms are written in English. Where a translation is provided for convenience, the English version prevails.',
          },
        ]}
      />
    ),
  },
  {
    id: 'contact',
    title: 'How to contact us',
    body: (
      <>
        <FactTable
          head={['', 'Detail']}
          rows={[
            ['Entity', ENTITY],
            ['Registered office', formatAddress(LEGAL_ENTITY.registeredOffice)],
            ['CIN', entityText(LEGAL_ENTITY.cin)],
            ['GSTIN', entityText(LEGAL_ENTITY.gstin)],
            ['Support', <Mailto key="support" address={LEGAL_ENTITY.email.support} />],
            ['Legal', <Mailto key="legal" address={LEGAL_ENTITY.email.legal} />],
            ['Grievances', <Mailto key="grievance" address={LEGAL_ENTITY.email.grievance} />],
            ['Telephone', entityText(LEGAL_ENTITY.phone)],
          ]}
        />
      </>
    ),
  },
];

export function TermsPage() {
  return (
    <LegalDocument
      eyebrow="Legal"
      title="Terms of Service"
      summary="The agreement between you and Saarthi: what you may do with the Platform, what we are responsible for, and what we are not."
      version={TERMS_VERSION}
      sections={SECTIONS}
      related={{ to: '/privacy', label: 'Read the Privacy Policy' }}
    />
  );
}

export default TermsPage;
