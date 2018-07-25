import React from 'react';
import Farmhand from '../src/components/farmhand';
import { stageFocusType } from '../src/enums';
import { shallow } from 'enzyme';
import assert from 'assert';
import { testItem } from './test-utils';

let component;

describe('event handlers', () => {
  beforeEach(() => {
    component = shallow(<Farmhand />);
  });

  describe('handlePurchaseItem', () => {
    describe('user has enough money', () => {
      it('creates a new item in the inventory', () => {
        component.instance().handlePurchaseItem(testItem({ id: 'some-item' }));
        assert.deepEqual(component.state().inventory, { 'some-item': 1 });
      });

      describe('existing items', () => {
        beforeEach(() => {
          component.setState({ inventory: { 'some-item': 1 } });
        });

        it('increments an existing item in the inventory', () => {
          component.instance().handlePurchaseItem({ id: 'some-item' });
          assert.deepEqual(component.state().inventory, { 'some-item': 2 });
        });
      });

      describe('money state', () => {
        beforeEach(() => {
          component.setState({ money: 100 });
          component.instance().handlePurchaseItem(testItem({ value: 10 }));
        });

        it('deducts item value from money', () => {
          assert.equal(component.state('money'), 90);
        });
      });
    });

    describe('user does not have enough money', () => {
      beforeEach(() => {
        component.setState({ money: 5 });
        component
          .instance()
          .handlePurchaseItem(testItem({ id: 'expensive-item', value: 10 }));
      });

      it('does not add the item to the inventory', () => {
        assert.deepEqual(component.state('inventory'), {});
      });

      it('does not deduct item value from money', () => {
        assert.equal(component.state('money'), 5);
      });
    });
  });

  describe('handleChangeView', () => {
    beforeEach(() => {
      component
        .instance()
        .handleChangeView({ target: { value: stageFocusType.SHOP } });
    });

    it('changes the view type', () => {
      assert.equal(component.state('stageFocus'), stageFocusType.SHOP);
    });
  });
});