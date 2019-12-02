import Typography from 'typography';
import CodePlugin from 'typography-plugin-code';
import fairyGatesTheme from 'typography-theme-fairy-gates';

import dimensions from './dimensions';
import colors from './colors';

fairyGatesTheme.overrideThemeStyles = () => {
  const linkColor = colors.use.accent.primary;
  return ({
    a: {
      color: linkColor,
      textShadow: 'none',
      backgroundImage: 'none',
      borderBottom: `1px solid ${linkColor}`,
      transition: 'color 200ms linear, border-bottom-color 200ms linear',
    },
    blockquote: {
      color: colors.use.text.secondary,
    },
    [`@media only screen and (max-width: ${dimensions.use.breakpoints.mobile})`]: {
      blockquote: {
        color: 'inherit',
      },
    },
  });
};

const typography = new Typography({
  ...fairyGatesTheme,
  headerColor: colors.use.text.primary,
  bodyColor: colors.use.text.primary,
  plugins: new CodePlugin(),
});

export default typography;
