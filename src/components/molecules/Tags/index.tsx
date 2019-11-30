import * as React from 'react';
import { math } from 'polished';

import { Tag } from '@atoms';
import styled from '@styled';

const Container = styled.ol`
  display: flex;
  flex-wrap: wrap;
  list-style: none;
  margin: -${p => math(`${p.theme.dimensions.use.margin} / 4`)};

  & > ${Tag} {
    margin: ${p => math(`${p.theme.dimensions.use.margin} / 4`)};
  }
`;

interface Tag {
  label: string;
  kind: React.ComponentProps<typeof Tag>['kind'];
}

interface Props {
  tags: Tag[];
}

const Tags: React.FC<Props> = ({ tags }) => (
  <Container>
    {tags.map(({ kind, label }) => (
      <Tag key={label} as="li" kind={kind}>
        {label}
      </Tag>
    ))}
  </Container>
);

export default Tags;
