// Build-time icon resolver for the marketing site.
//
// The React build resolved kebab-case `<Icon name="scan-line" />` through an
// explicit named-import map so the bundler tree-shook lucide down to the icons
// the pages actually use. This keeps the same contract with zero client
// JavaScript: every icon is imported as raw SVG text and inlined into the HTML
// at build time, so the shipped page carries the artwork and no icon library.
//
// The imports stay explicit (rather than a glob over lucide-static's ~2000
// files) for the same reason as before: adding a new `name` must be a
// deliberate edit here, and a typo fails the build instead of silently
// rendering a fallback circle.

import apple from 'lucide-static/icons/apple.svg?raw';
import alertOctagon from 'lucide-static/icons/octagon-alert.svg?raw';
import alertTriangle from 'lucide-static/icons/triangle-alert.svg?raw';
import arrowDownToLine from 'lucide-static/icons/arrow-down-to-line.svg?raw';
import arrowLeftRight from 'lucide-static/icons/arrow-left-right.svg?raw';
import arrowRight from 'lucide-static/icons/arrow-right.svg?raw';
import arrowUp from 'lucide-static/icons/arrow-up.svg?raw';
import arrowUpRight from 'lucide-static/icons/arrow-up-right.svg?raw';
import barChart2 from 'lucide-static/icons/bar-chart-2.svg?raw';
import bell from 'lucide-static/icons/bell.svg?raw';
import bookOpen from 'lucide-static/icons/book-open.svg?raw';
import calendar from 'lucide-static/icons/calendar.svg?raw';
import check from 'lucide-static/icons/check.svg?raw';
import checkCircle2 from 'lucide-static/icons/check-circle-2.svg?raw';
import chevronDown from 'lucide-static/icons/chevron-down.svg?raw';
import chevronRight from 'lucide-static/icons/chevron-right.svg?raw';
import circle from 'lucide-static/icons/circle.svg?raw';
import clock from 'lucide-static/icons/clock.svg?raw';
import code2 from 'lucide-static/icons/code-2.svg?raw';
import coffee from 'lucide-static/icons/coffee.svg?raw';
import download from 'lucide-static/icons/download.svg?raw';
import edit3 from 'lucide-static/icons/edit-3.svg?raw';
import feather from 'lucide-static/icons/feather.svg?raw';
import fileText from 'lucide-static/icons/file-text.svg?raw';
import gitBranch from 'lucide-static/icons/git-branch.svg?raw';
import globe from 'lucide-static/icons/globe.svg?raw';
import handshake from 'lucide-static/icons/handshake.svg?raw';
import heartHandshake from 'lucide-static/icons/heart-handshake.svg?raw';
import history from 'lucide-static/icons/history.svg?raw';
import image from 'lucide-static/icons/image.svg?raw';
import info from 'lucide-static/icons/info.svg?raw';
import languages from 'lucide-static/icons/languages.svg?raw';
import lifeBuoy from 'lucide-static/icons/life-buoy.svg?raw';
import lightbulb from 'lucide-static/icons/lightbulb.svg?raw';
import lock from 'lucide-static/icons/lock.svg?raw';
import mail from 'lucide-static/icons/mail.svg?raw';
import map from 'lucide-static/icons/map.svg?raw';
import mapPin from 'lucide-static/icons/map-pin.svg?raw';
import arrowRightLeft from 'lucide-static/icons/arrow-right-left.svg?raw';
import banknote from 'lucide-static/icons/banknote.svg?raw';
import creditCard from 'lucide-static/icons/credit-card.svg?raw';
import eyeOff from 'lucide-static/icons/eye-off.svg?raw';
import logIn from 'lucide-static/icons/log-in.svg?raw';
import percent from 'lucide-static/icons/percent.svg?raw';
import qrCode from 'lucide-static/icons/qr-code.svg?raw';
import receipt from 'lucide-static/icons/receipt.svg?raw';
import rotateCcw from 'lucide-static/icons/rotate-ccw.svg?raw';
import trendingUp from 'lucide-static/icons/trending-up.svg?raw';
import messageCircle from 'lucide-static/icons/message-circle.svg?raw';
// The theme toggle used lucide's Sun/Moon directly in the React header.
import moon from 'lucide-static/icons/moon.svg?raw';
import sun from 'lucide-static/icons/sun.svg?raw';
import newspaper from 'lucide-static/icons/newspaper.svg?raw';
import packageIcon from 'lucide-static/icons/package.svg?raw';
import play from 'lucide-static/icons/play.svg?raw';
import printer from 'lucide-static/icons/printer.svg?raw';
import refreshCw from 'lucide-static/icons/refresh-cw.svg?raw';
import rocket from 'lucide-static/icons/rocket.svg?raw';
import scanLine from 'lucide-static/icons/scan-line.svg?raw';
import search from 'lucide-static/icons/search.svg?raw';
import searchX from 'lucide-static/icons/search-x.svg?raw';
import send from 'lucide-static/icons/send.svg?raw';
import shieldCheck from 'lucide-static/icons/shield-check.svg?raw';
import shoppingBag from 'lucide-static/icons/shopping-bag.svg?raw';
import shoppingCart from 'lucide-static/icons/shopping-cart.svg?raw';
import sparkles from 'lucide-static/icons/sparkles.svg?raw';
import square from 'lucide-static/icons/square.svg?raw';
import thumbsDown from 'lucide-static/icons/thumbs-down.svg?raw';
import thumbsUp from 'lucide-static/icons/thumbs-up.svg?raw';
import user from 'lucide-static/icons/user.svg?raw';
import wallet from 'lucide-static/icons/wallet.svg?raw';
import warehouse from 'lucide-static/icons/warehouse.svg?raw';
import wifi from 'lucide-static/icons/wifi.svg?raw';
import wifiOff from 'lucide-static/icons/wifi-off.svg?raw';
import wrench from 'lucide-static/icons/wrench.svg?raw';
import x from 'lucide-static/icons/x.svg?raw';

// lucide dropped its brand icons after 0.468; this one is vendored from that
// exact release so the GitHub affordance keeps the artwork the site shipped.
import github from '../icons/github.svg?raw';

const ICONS = {
  apple,
  'alert-octagon': alertOctagon,
  'alert-triangle': alertTriangle,
  'arrow-down-to-line': arrowDownToLine,
  'arrow-left-right': arrowLeftRight,
  'arrow-right': arrowRight,
  'arrow-up': arrowUp,
  'arrow-up-right': arrowUpRight,
  'bar-chart-2': barChart2,
  bell,
  'book-open': bookOpen,
  calendar,
  check,
  'check-circle-2': checkCircle2,
  'chevron-down': chevronDown,
  'chevron-right': chevronRight,
  clock,
  'code-2': code2,
  coffee,
  // The design uses a tiny "dot" bullet; lucide's Circle stands in for it.
  dot: circle,
  download,
  'edit-3': edit3,
  feather,
  'file-text': fileText,
  'git-branch': gitBranch,
  github,
  globe,
  handshake,
  'heart-handshake': heartHandshake,
  history,
  image,
  info,
  languages,
  'life-buoy': lifeBuoy,
  lightbulb,
  lock,
  mail,
  map,
  'map-pin': mapPin,
  'arrow-right-left': arrowRightLeft,
  banknote,
  'credit-card': creditCard,
  'eye-off': eyeOff,
  'log-in': logIn,
  percent,
  'qr-code': qrCode,
  receipt,
  'rotate-ccw': rotateCcw,
  'trending-up': trendingUp,
  'message-circle': messageCircle,
  moon,
  newspaper,
  package: packageIcon,
  play,
  printer,
  'refresh-cw': refreshCw,
  rocket,
  'scan-line': scanLine,
  search,
  'search-x': searchX,
  send,
  'shield-check': shieldCheck,
  'shopping-bag': shoppingBag,
  'shopping-cart': shoppingCart,
  sparkles,
  square,
  sun,
  'thumbs-down': thumbsDown,
  'thumbs-up': thumbsUp,
  user,
  wallet,
  warehouse,
  wifi,
  'wifi-off': wifiOff,
  wrench,
  x,
};

/** Everything between the source SVG's opening and closing tag. */
const INNER_RE = /<svg[^>]*>([\s\S]*?)<\/svg>/i;

/**
 * The drawable body of an icon, ready to be inlined inside a `<svg>` the
 * caller owns (so size, stroke width and colour stay under our control rather
 * than lucide's 24px / stroke-width-2 defaults).
 *
 * Unknown names throw: an icon that silently degrades to a blank circle is a
 * visual regression nobody notices until it ships.
 */
export function iconInner(name) {
  const source = ICONS[name];
  if (!source) {
    throw new Error(`Icon: unknown name "${name}". Add it to the import map in src/lib/icons.js.`);
  }
  const match = INNER_RE.exec(source);
  if (!match) {
    throw new Error(`Icon: could not parse the SVG body for "${name}".`);
  }
  return match[1].trim();
}

/** Every name the site can render — used by the icon coverage test. */
export const ICON_NAMES = Object.keys(ICONS);
