import Typography from 'typography';
import CodePlugin from 'typography-plugin-code';
import fairyGatesTheme from 'typography-theme-fairy-gates';

import colors from './colors';

fairyGatesTheme.overrideThemeStyles = () => {
  const linkColor = colors.use.accent.primary;
  return ({
    a: {
      color: linkColor,
      textShadow: 'none',
      backgroundImage: `linear-gradient(to top, rgba(0, 0, 0, 0), rgba(0, 0, 0, 0) 1px, ${linkColor} 1px, ${linkColor} 2px, rgba(0, 0, 0, 0) 2px)`,
    },
    blockquote: {
      color: colors.use.text.secondary,
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
