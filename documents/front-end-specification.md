# GymPulse Front End Specification Document

## 1. Overview

This document specifies the front-end implementation requirements for the GymPulse web application built with Next.js 16.3.6, React 19.2.8, and Tailwind CSS.

## 2. Project Structure

### 2.1 Directory Structure
```
src/app/          - Next.js App Router pages and routes
src/components/   - Reusable UI components
  - admin/        - Admin-specific components
  - app/          - App-specific components
  - auth/         - Authentication components
  - brand/        - Branding elements
  - pwa/          - PWA-related components
  - three/        - Three.js components
  - ui/           - Base UI components (shadcn/ui style)
src/lib/          - Utility functions and helpers
src/types/        - TypeScript type definitions
src/hooks/        - Custom React hooks
src/config/       - Configuration files
```

### 2.2 Key Conventions
- **TypeScript** throughout with strict mode
- **Tailwind CSS** v4 for styling
- **shadcn/ui** component patterns
- **Motion** (Framer Motion) for animations
- **Responsive design** mobile-first approach
- **Accessibility** (a11y) standards compliance

## 3. Page Specifications

### 3.1 Authentication Pages
#### Login Page (`/login`)
- Form with email/phone and password
- Role selection dropdown (Owner/Manager/Staff/Trainer/Member)
- "Remember me" checkbox
- Demo account information display
- Forgot password link
- Error handling for invalid credentials

#### Member Portal (`/`)
- Home page with:
  - Current streak display (with flame icon 🔥)
  - Days to next milestone progress
  - Current membership status & expiry date
  - Check-in pass (QR code)
  - Latest gym announcements
- Attendance & Challenges section:
  - 16-week attendance calendar
  - Stats: current streak, this week/month visits, best all-time streak
  - Milestones: Bronze (5-day), Silver (10-day), Gold (14-day), Platinum (30-day), Club 50/100
  - Monthly challenges: 10/20 visits, Weekend Warrior, Early Bird, 30-day streak
  - Rewards section: badges, discounts, free sessions

#### Gym Owner Dashboard (`/owner`)
- Pulse Screen (Members at Risk)
- Staff Check-In
- Reports & Analytics
- Membership Plans management
- Payment Providers configuration
- Automations management
- Challenges & rewards configuration
- Branches management
- Announcements management
- Multiple branches/gyms support

#### Member Profile Page (`/member/[id]`)
- Member details display
- Attendance history
- Current streak and milestones
- Membership information
- Bookings and scheduled sessions
- Rewards and badges

### 3.2 Staff Functions Pages
#### Check-In Workflow
- QR code check-in interface
- Manual member lookup form
- Check-in confirmation display
- Streak update display

#### Member Recovery
- At-risk member listing
- Task assignment interface
- Contact method selection (Call, WhatsApp, SMS)
- Outcome recording (Returned, Renewed, Lost)
- Contact notes and outcome tracking

#### Booking Management
- View member bookings
- Session status update (Pending → Confirmed → Completed)
- Session rescheduling
- Session completion marking

### 3.3 Trainer Pages
#### Trainer Dashboard
- Assigned member profiles
- Booking management
- Session progress updates
- Member attendance and streaks
- Recovery message sending

#### Booking Details
- Session information display
- Date and time selection
- Member details
- Progress tracking

### 3.4 Vendor Pages
#### Vendor Dashboard
- Product/inventory management
- Order and fulfillment tracking
- Vendor analytics
- Gym partnership management

#### Product Catalog
- Product listing with details
- Inventory status
- Order history
- Commission tracking

## 4. Component Specifications

### 4.1 Base UI Components (shadcn/ui style)
#### Button Variants
- Primary, Secondary, Destructive, Ghost
- Size variants: sm, md, lg
- Loading state support
- Disabled state styling

#### Input Components
- Text input with label
- Email input with validation
- Password input with show/hide
- Number input for quantities

#### Form Components
- Form with validation (using react-hook-form + Zod)
- Field error display
- Submit button with loading state
- Reset functionality

#### Card Components
- Information card
- Dashboard card
- Member card with avatar and stats

#### Notification Bell
- Unread count display
- Quick-look panel
- Toast notifications
- Instant refresh on push arrival
- Installed app unread count on icon

### 4.2 Dashboard Components
#### Streak Display
- Flame icon 🔥
- Current streak number
- Progress bar to next milestone
- "Rest day allowed" indicator

#### Milestone Progress
- Tiered badge display (Bronze, Silver, Gold, Platinum, Club 50/100)
- Unlocked status visualization
- Progress toward next tier

#### Attendance Calendar
- 16-week grid visualization
- Visit day highlighting
- Current day marker
- Streak tracking visualization

#### Challenge Progress
- Monthly challenge cards
- Progress percentage
- Days remaining
- Reward status

### 4.3 Interaction Components
#### QR Code Scanner
- Member pass QR code display
- Rotating kiosk QR code
- Scan animation
- Validation feedback

#### Check-In Form
- Manual member search
- Member code lookup
- Check-in button
- Confirmation modal

#### Payment Form
- Payment method selection (eSewa, Khalti, Cash/Bank)
- Form fields for each provider
- Transaction status display
- Receipt generation

#### Announcement composer
- Headline input
- Message textarea
- Audience selection (members/staff/everyone)
- End date picker
- Draft/publish toggle

## 5. State Management

### 5.1 Local State
- Component-level state with useState
- Form state with react-hook-form
- UI state (open/close modals, dropdowns)

### 5.2 Global State
- User authentication state (context or Zustand)
- Theme state (light/dark)
- Notification state (unread count, new alerts)
- Member selection state (for operations)

### 5.3 Server State
- SWR or React Query for data fetching
- Cache invalidation strategies
- Real-time updates for check-in status
- Push notification subscription management

## 6. Notification System

### 6.1 In-App Notifications
- Bell icon with unread count
- Quick-look panel on click
- Toast notifications for new alerts
- Instant refresh on push arrival
- Mark read everywhere (bell, inbox, phone)

### 6.2 Push Notifications
- VAPID key pair configuration
- Device registration endpoint
- Channel-specific preferences (SMS, Email, WhatsApp, In-app)
- Turn off per category in preferences
- Stops on device sign-out (shared device protection)
- Home Screen installation for iPhone/iPad

### 6.3 Notification Types
- Check-in confirmations
- Membership expiry reminders (7, 3, 1 day before)
- Payment receipts
- Milestone achievements
- Challenge completions
- Recovery task assignments
- New announcements
- Marketplace purchase confirmations

## 7. QR Code & Check-In

### 7.1 QR Code Generation
- Member pass QR code (valid 5 minutes per code)
- Rotating kiosk QR code for front desk
- QR code with member information
- Expiration and rotation logic

### 7.2 Check-In Interfaces
#### QR Code Scan
- Scanner component with frame
- Flash support for low light
- Automatic membership validation
- Immediate attendance recording

#### Manual Check-In
- Member search by name/code
- Gym/branch selection
- Check-in note addition
- Confirmation and streak update

## 8. Gamification Visualization

### 8.1 Streak Display
- Flame icon with current count
- Days since last visit if broken
- Best streak all-time display
- Progress to next milestone

### 8.2 Milestone Badges
- Tiered badge component
- "Unlocked" vs "Locked" states
- Badge count display
- Hover tooltips with achievement details

### 8.3 Monthly Challenge Cards
- Challenge title and description
- Progress bar
- Target vs. actual count
- Completion status
- Reward preview

### 8.4 Rewards Section
- Badge display grid
- Discount percentage display
- Free session/voucher info
- Earn date and details
- Reward history timeline

## 9. Marketplace Components

### 9.1 Product Catalog
- Filter by category
- Search functionality
- Product card with image, title, price
- Stock status indicator
- "Suggest based on streak" badge

### 9.2 Purchase Flow
- Product selection modal
- Quantity selector
- Payment method selection
- Purchase confirmation
- Booking creation for services

### 9.3 Bundle Builder
- Multi-select for bundle items
- Price calculation with savings
- Bundle availability check (all items in stock)
- Order creation with bundle grouping

## 10. Responsive Design Breakpoints

### 10.1 Mobile (320px - 768px)
- Full member portal access
- Simplified dashboard
- Touch-friendly interactions
- QR code large enough for scanning

### 10.2 Tablet (768px - 1024px)
- Enhanced dashboard view
- Side navigation
- Dual-column layouts where beneficial

### 10.3 Desktop (1024px+)
- Full feature access
- Multi-pane layouts
- Keyboard shortcuts support
- Comprehensive analytics

### 10.4 Large Desktop (1440px+)
- Expanded tables and grids
- Sidebar with quick access
- Dashboard panoramic views

## 11. Accessibility (a11y) Requirements

### 11.1 Color Contrast
- Minimum 4.5:1 for normal text
- Minimum 3:1 for large text
- Focus visible states on all interactive elements

### 11.2 Keyboard Navigation
- Tab order logical and complete
- Escape key closes modals/dropdowns
- Accessible rich internet applications (ARIA) labels

### 11.3 Screen Reader Support
- Descriptive alt text for images
- Proper heading hierarchy (h1-h6)
- Landmark regions for navigation
- Form field labels associated with inputs

### 11.4 Motion Preferences
- Respect `prefers-reduced-motion`
- Reduced animation alternatives
- No auto-playing media without user consent

## 12. Performance Requirements

### 12.1 Page Load Times
- Initial paint < 1 second on 3G
- Time to interactive < 2 seconds
- First contentful paint optimization

### 12.2 Asset Optimization
- Images: Next.js Image component with WebP/AVIF
- Fonts: Next.js font optimization
- Code splitting: route-based dynamic imports
- Lazy loading for non-critical components

### 12.3 API Response Times
- Authentication endpoints < 500ms
- Data fetching endpoints < 1 second
- Real-time updates < 200ms latency

## 13. Browser Compatibility

### 13.1 Supported Browsers
- Chrome (latest 2 versions)
- Firefox (latest 2 versions)
- Safari (latest 2 versions)
- Edge (latest 2 versions)

### 13.2 Mobile Browsers
- iOS Safari
- Chrome for Android
- Default Android browser

### 13.3 Features Not Supported
- Legacy IE11 support not required
- Older browser polyfills as needed

## 14. Error Handling & Loading States

### 14.1 Loading Skeletons
- Component-level skeleton loaders
- Page-level skeleton screens
- Spinner/generator combinations
- Progressive content reveal

### 14.2 Error Boundaries
- Global error boundary at root
- Component-level error handling
- User-friendly error messages
- Error recovery actions (retry, dismiss)

### 14.3 Error Types
- Validation errors (form field highlights)
- Network errors (retry options)
- Not found (404 page with navigation)
- Unauthorized (redirect to login)
- Server errors (generic message + reporting)

## 15. Localization Considerations

### 15.1 Supported Languages
- English (primary)
- Nepali (integrated via nepali-date-converter)

### 15.2 Date/Time Formatting
- Nepali date conversion where applicable
- Gregorian dates for database/storage
- Relative time display ("2 days ago", "expires in 7 days")
- Time zone awareness for international gyms

### 15.3 Number Formatting
- Nepalese rupee (₹) symbol formatting
- Thousands separators
- Currency conversion where needed