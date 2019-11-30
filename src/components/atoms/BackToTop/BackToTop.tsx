import * as React from 'react';
import { useWindowScroll } from 'react-use';
import { math, transparentize } from 'polished';
import { FaArrowUp } from 'react-icons/fa';

import styled, { css } from '@styled';

const Container = styled.button`
  ${p => css`
    font-size: ${p.theme.typography.scale(0.4).fontSize};
    line-height: ${p.theme.typography.scale(0.4).fontSize};
  `}
  
  display: flex;
  padding: ${p => math(`${p.theme.dimensions.use.margin} * 0.66`)};
  position: fixed;
  bottom: ${p => p.theme.dimensions.use.margin};
  right: ${p => p.theme.dimensions.use.margin};
  border-radius: ${p => p.theme.dimensions.use.borderRadius.large};
  color: ${p => p.theme.colors.use.text.primary};
  background-color: ${p => p.theme.colors.use.background.secondary};
  border: none;
  box-shadow: ${p => transparentize(0.2, p.theme.colors.base.charade)} 0px 6px 9px 0px;
  cursor: pointer;
  opacity: 0.3;
  transition: opacity 200ms linear;

  &:hover {
    opacity: 1;
  }
`;

interface Props {
  visibleAfterY?: number;
}

const scrollToTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });

const BackToTop: React.FC<Props> = ({ visibleAfterY = 0 }) => {
  const { y } = useWindowScroll();
  return y > visibleAfterY ?
    <Container onClick={scrollToTop}><FaArrowUp /></Container> : null;
};

export default BackToTop;
