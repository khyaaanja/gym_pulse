import { fetch } from 'undici';

// Scroll check script for GymPulse
// Verifies page content scrollability and loaded content

async function checkScrollability() {
  console.log('GymPulse Scroll Content Check');
  console.log('=============================\n');

  const URLs = [
    'http://localhost:3000',
    'http://localhost:3000/login',
    'http://localhost:3000/checkin',
    'http://localhost:3000/marketplace',
  ];

  for (const url of URLs) {
    try {
      const response = await fetch(url);
      const html = await response.text();

      // Check for scroll-related content patterns
      const scrollPatterns = [
        /scrollTop/i,
        /overflow-y/i,
        /scrollHeight/i,
        /clientHeight/i,
      ];

      const foundPatterns = scrollPatterns.filter(pattern =>
        pattern.test(html)
      );

      console.log(`${url}: ${foundPatterns.length} scroll patterns found`);
      if (foundPatterns.length > 0) {
        console.log(`  Patterns: ${foundPatterns.join(', ')}`);
      }
    } catch (error) {
      console.log(`${url}: Error - ${error.message}`);
    }
  }

  console.log('\nScroll check complete.');
}

checkScrollability();