const base = {
  xxSmall: '2px',
  xSmall: '4px',
  small: '8px',
  normal: '16px',
  large: '32px',
  xLarge: '64px',
};

const use = {
  margin: base.normal,
  screen: base.large,
  borderRadius: {
    normal: base.xxSmall,
    large: base.xSmall,
  },
  breakpoints: {
    larger: '1600px',
    large: '1280px',
    default: '980px',
    tablet: '768px',
    mobile: '480px',
  },
};

const dimensions = { base, use };

export default dimensions;
