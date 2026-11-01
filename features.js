// Browser Kit: the list of toggles shown in the popup. Shared by popup.js and
// settings.js. Each key becomes an attribute on <html> (ytqh-<key>) while it's
// on, and hide.css hides things based on those attributes.

const YTQH_FEATURES = [
  { group: 'General' },
  { key: 'enabled', label: 'Extension enabled', def: true },
  { key: 'quick-hide', label: '🚫 Don\'t recommend button on thumbnails', def: true },

  { group: 'Ads' },
  { key: 'block-ads', label: 'Block ads (banners, promos, ad requests)', def: true },
  { key: 'skip-ads', label: 'Skip video ads (mute + fast-forward)', def: true },

  { group: 'Home & navigation' },
  { key: 'home-feed', label: 'Hide homepage feed' },
  { key: 'shorts', label: 'Hide YouTube Shorts' },
  { key: 'mixes', label: 'Hide Mix / radio playlists' },
  { key: 'subscriptions', label: 'Hide and redirect Subscriptions' },
  { key: 'explore', label: 'Hide Explore and Trending' },
  { key: 'more-from-youtube', label: 'Hide More from YouTube' },
  { key: 'header', label: 'Hide top header' },
  { key: 'notifications', label: 'Hide notification bell' },
  { key: 'search-junk', label: 'Hide irrelevant search results' },

  { group: 'Watch page' },
  { key: 'dislikes', label: 'Show dislike counts (Return YouTube Dislike)', def: true },
  { key: 'video-sidebar', label: 'Hide video sidebar' },
  { key: 'related', label: 'Hide recommended (related videos)' },
  { key: 'live-chat', label: 'Hide live chat' },
  { key: 'playlist', label: 'Hide playlist' },
  { key: 'comments', label: 'Hide comments' },
  { key: 'merch', label: 'Hide merch, tickets, offers' },
  { key: 'video-info', label: 'Hide video info' },
  { key: 'video-buttons', label: 'Hide video buttons bar (likes, share…)' },
  { key: 'channel', label: 'Hide channel (profile + subscribe)' },
  { key: 'description', label: 'Hide video description' },

  { group: 'Player' },
  { key: 'endscreen-wall', label: 'Hide end screen videowall' },
  { key: 'endscreen-cards', label: 'Hide end screen cards' },
  { key: 'annotations', label: 'Disable annotations' },
  { key: 'autoplay', label: 'Disable autoplay' },

  // speed.js: works on every site, not just YouTube. tab: 'speed' puts this
  // group in the popup's Video controller tab (under its ⚙ settings).
  { group: 'Speed controller (all sites)', tab: 'speed' },
  { key: 'speed', label: 'Speed controller for video and audio', def: true },
  { key: 'speed-overlay', label: 'Show speed on videos', def: true },
  { key: 'speed-remember', label: 'Remember speed across videos', def: true },
  { note: 'S / D slower / faster · R reset · G 1.8× · Z / X back / forward 10s · P pop out · A A–B loop · V show / hide' },
];

const YTQH_DEFAULTS = Object.fromEntries(
  YTQH_FEATURES.filter((f) => f.key).map((f) => [f.key, !!f.def]));
