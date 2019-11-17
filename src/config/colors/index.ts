import { transparentize } from 'polished';

// Colors named according to: http://chir.ag/projects/name-that-color/
import base from './palette.json';

const use = {
  background: {
    primary: base.white,
    secondary: base.whisper,
    tertiary: base.yellowOrange,
  },
  accent: {
    danger: base.radicalRed,
    info: base.azureRadiance,
    primary: base.dodgerBlue,
    secondary: base.electricViolet,
    success: base.caribbeanGreen,
    warning: base.webOrange,
  },
  text: {
    blackPrimary: transparentize(0.87, base.black),
    blackSecondary: transparentize(0.54, base.black),
    blackTertiary: transparentize(0.38, base.black),
    whitePrimary: base.white,
    whiteSecondary: transparentize(0.7, base.white),
    whiteTertiary: transparentize(0.5, base.white),
  },
};

const colors = { base, use };

export default colors;
