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
};

const dimensions = { base, use };

export default dimensions;
