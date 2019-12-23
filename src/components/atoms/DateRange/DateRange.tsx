import * as React from 'react';
import { DateTime } from 'luxon';

import styled from '@styled';

const Container = styled.div`
  display: flex;

  color: ${p => p.theme.colors.use.text.tertiary};
`;

const Dash = styled.span`
  margin: 0 ${p => p.theme.dimensions.base.small};

  &::before {
    content: "-";
  }
`;

interface Props {
  startDate: string;
  endDate?: string;
  className?: string;
}

const DateRange: React.FC<Props> = ({
  startDate,
  className,
  endDate = DateTime.local().toISODate(),
}) => (
  <Container className={className}>
    <time dateTime={startDate}>
      {DateTime.fromISO(startDate).toFormat('MMM. yyyy')}
    </time>
    <Dash />
    <time dateTime={endDate}>
      {DateTime.fromISO(endDate).hasSame(DateTime.local(), 'month') ?
        'Present' :
        DateTime.fromISO(endDate).toFormat('MMM. yyyy')}
    </time>
  </Container>
);

export default DateRange;
