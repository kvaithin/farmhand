import React, { Component } from 'react';
import { HotKeys } from 'react-hotkeys';
import localforage from 'localforage';
import { MuiThemeProvider } from '@material-ui/core/styles';
import Drawer from '@material-ui/core/Drawer';
import Fab from '@material-ui/core/Fab';
import HotelIcon from '@material-ui/icons/Hotel';
import Tooltip from '@material-ui/core/Tooltip';
import throttle from 'lodash.throttle';

import FarmhandContext from './Farmhand.context';
import eventHandlers from './event-handlers';
import {
  addItemToInventory,
  computePlayerInventory,
  computeStateForNextDay,
  decrementItemFromInventory,
  getFieldToolInventory,
  getFinalCropItemIdFromSeedItemId,
  getPlantableCropInventory,
  getWateredField,
  modifyFieldPlotAt,
  purchaseItem,
  removeFieldPlotAt,
} from './data-transformers';
import AppBar from './components/AppBar';
import Navigation from './components/Navigation';
import ContextPane from './components/ContextPane';
import Stage from './components/Stage';
import NotificationSystem from './components/NotificationSystem';
import DebugMenu from './components/DebugMenu';
import theme from './mui-theme';
import {
  createNewField,
  getCropFromItemId,
  getCropLifeStage,
  getCowValue,
  getPlotContentFromItemId,
  getRangeCoords,
  getAdjustedItemValue,
  generateCow,
} from './utils';
import shopInventory from './data/shop-inventory';
import { itemsMap } from './data/maps';
import {
  cropLifeStage,
  fieldMode,
  plotContentType,
  stageFocusType,
} from './enums';
import {
  FERTILIZER_ITEM_ID,
  PURCHASEABLE_COW_PENS,
  PURCHASEABLE_FIELD_SIZES,
  SCARECROW_ITEM_ID,
  SPRINKLER_ITEM_ID,
} from './constants';
import { COW_PEN_PURCHASED } from './templates';
import { PROGRESS_SAVED_MESSAGE } from './strings';

import './Farmhand.sass';

const { GROWN } = cropLifeStage;
const { FERTILIZE, OBSERVE, SET_SCARECROW, SET_SPRINKLER } = fieldMode;

const itemIds = Object.freeze(Object.keys(itemsMap));

/**
 * @typedef farmhand.state
 * @type {Object}
 * @property {farmhand.cow} cowForSale
 * @property {Array.<farmhand.cow>} cowInventory
 * @property {number} dayCount
 * @property {Array.<Array.<?farmhand.plotContent>>} field
 * @property {{ x: number, y: number }} hoveredPlot
 * @property {number} hoveredPlotRangeSize
 * @property {Array.<{ item: farmhand.item, quantity: number }>} inventory
 * @property {boolean} isMenuOpen
 * @property {number} money
 * @property {Array.<string} newDayNotifications
 * @property {Array.<string>} notifications
 * @property {string} selectedItemId
 * @property {farmhand.module:enums.fieldMode} fieldMode
 * @property {number} purchasedCowPen
 * @property {number} purchasedField
 * @property {Array.<farmhand.item>} shopInventory
 * @property {boolean} doShowNotifications
 * @property {farmhand.module:enums.stageFocusType} stageFocus
 * @property {Object.<number>} valueAdjustments
 */

export default class Farmhand extends Component {
  // Bind event handlers
  handlers = {
    ...Object.keys(eventHandlers).reduce((acc, method) => {
      acc[method] = eventHandlers[method].bind(this);
      return acc;
    }, {}),
  };

  localforage = localforage.createInstance({
    name: 'farmhand',
    description: 'Persisted game data for Farmhand',
  });

  /**
   * @member farmhand.Farmhand#state
   * @type {farmhand.state}
   */
  state = {
    cowForSale: {},
    cowInventory: [],
    dayCount: 0,
    field: createNewField(),
    hoveredPlot: { x: null, y: null },
    hoveredPlotRangeSize: 0,
    inventory: [],
    isMenuOpen: true,
    money: 500,
    newDayNotifications: [],
    notifications: [],
    selectedItemId: '',
    fieldMode: OBSERVE,
    purchasedCowPen: 0,
    purchasedField: 0,
    shopInventory: [...shopInventory],
    doShowNotifications: false,
    stageFocus: stageFocusType.FIELD,
    valueAdjustments: {},
  };

  constructor() {
    super(...arguments);

    this.initKeyHandlers();
  }

  static reduceByPersistedKeys(state) {
    return [
      'cowForSale',
      'cowInventory',
      'dayCount',
      'field',
      'inventory',
      'money',
      'newDayNotifications',
      'purchasedCowPen',
      'purchasedField',
      'valueAdjustments',
    ].reduce((acc, key) => {
      acc[key] = state[key];

      return acc;
    }, {});
  }

  get fieldToolInventory() {
    return getFieldToolInventory(this.state.inventory);
  }

  get hoveredPlotRange() {
    const {
      field,
      fieldMode,
      hoveredPlot: { x, y },
      hoveredPlotRangeSize,
    } = this.state;

    // If x is null, so is y.
    if (x === null) {
      return [[{ x: null, y: null }]];
    }

    if (fieldMode === SET_SPRINKLER) {
      return field[y][x]
        ? [[{ x, y }]]
        : getRangeCoords(hoveredPlotRangeSize, x, y);
    }

    return [[{ x, y }]];
  }

  get playerInventory() {
    const { inventory, valueAdjustments } = this.state;
    return computePlayerInventory(inventory, valueAdjustments);
  }

  get playerInventoryQuantities() {
    const { inventory } = this.state;

    return itemIds.reduce((acc, itemId) => {
      const itemInInventory = inventory.find(({ id }) => id === itemId);
      acc[itemId] = itemInInventory ? itemInInventory.quantity : 0;

      return acc;
    }, {});
  }

  get plantableCropInventory() {
    return getPlantableCropInventory(this.state.inventory);
  }

  get viewList() {
    const viewList = [stageFocusType.FIELD, stageFocusType.SHOP];

    if (this.state.purchasedCowPen) {
      viewList.push(stageFocusType.COW_PEN);
    }

    viewList.push(stageFocusType.INVENTORY);

    return viewList;
  }

  initKeyHandlers() {
    this.keyMap = {
      focusField: 'f',
      focusInventory: 'i',
      focusCows: 'c',
      focusShop: 's',
      incrementDay: 'shift+c',
      nextView: 'right',
      previousView: 'left',
      toggleMenu: 'm',
    };

    const keyHandlerThrottleTime = 150;

    this.keyHandlers = {
      focusField: () => this.setState({ stageFocus: stageFocusType.FIELD }),
      focusInventory: () =>
        this.setState({ stageFocus: stageFocusType.INVENTORY }),
      focusCows: () =>
        this.state.purchasedCowPen &&
        this.setState({ stageFocus: stageFocusType.COW_PEN }),
      focusShop: () => this.setState({ stageFocus: stageFocusType.SHOP }),
      incrementDay: () => this.incrementDay(),
      nextView: throttle(this.goToNextView.bind(this), keyHandlerThrottleTime),
      previousView: throttle(
        this.goToPreviousView.bind(this),
        keyHandlerThrottleTime
      ),
      toggleMenu: () => this.handlers.handleMenuToggle(),
    };

    Object.assign(this.keyMap, {
      clearPersistedData: 'shift+d',
      waterAllPlots: 'w',
    });

    Object.assign(this.keyHandlers, {
      clearPersistedData: () => this.clearPersistedData(),
      waterAllPlots: () => this.waterAllPlots(),
    });

    this.keyHandlers = Object.keys(this.keyHandlers).reduce((acc, key) => {
      const original = this.keyHandlers[key];
      const { activeElement } = document;

      acc[key] = (...args) =>
        // If user is not focused on an input element
        (activeElement.nodeName === 'INPUT' &&
          !activeElement.classList.contains('hotkeys')) ||
        original(...args);

      return acc;
    }, {});
  }

  componentDidMount() {
    this.localforage.getItem('state').then(state => {
      if (state) {
        const { newDayNotifications } = state;
        this.setState({ ...state, newDayNotifications: [] }, () => {
          newDayNotifications.forEach(notification =>
            this.showNotification(notification)
          );
        });
      } else {
        this.incrementDay();
      }
    });
  }

  componentDidUpdate(prevProps, prevState) {
    this.showStateChangeNotifications(prevState);
  }

  clearPersistedData() {
    this.localforage
      .clear()
      .then(() => this.showNotification('localforage.clear() succeeded!'));
  }

  /**
   * @param {string} message
   */
  showNotification(message) {
    this.setState(({ notifications }) => ({
      // Don't show redundant notifications
      notifications: notifications.includes(message)
        ? notifications
        : notifications.concat(message),
      doShowNotifications: true,
    }));
  }

  /**
   * @param {farmhand.state} prevState
   */
  showStateChangeNotifications(prevState) {
    const {
      state: { purchasedCowPen },
    } = this;

    if (purchasedCowPen !== prevState.purchasedCowPen) {
      const { cows } = PURCHASEABLE_COW_PENS.get(purchasedCowPen);

      this.showNotification(COW_PEN_PURCHASED`${cows}`);
    }
  }

  incrementDay() {
    const nextDayState = computeStateForNextDay(this.state);
    const pendingNotifications = [...nextDayState.newDayNotifications];

    // This would be cleaner if setState was called after localForage.setItem,
    // but updating the state first makes for a more responsive user
    // experience. The persisted state is computed post-update and stored
    // asynchronously, thus avoiding state changes from being blocked.

    this.setState(
      { ...nextDayState, newDayNotifications: [], notifications: [] },
      () => {
        this.localforage
          .setItem(
            'state',
            Farmhand.reduceByPersistedKeys({
              ...this.state,

              // Old pendingNotifications are persisted so that they can be
              // shown to the player when the app reloads.
              newDayNotifications: pendingNotifications,
            })
          )
          .then(({ newDayNotifications }) =>
            [PROGRESS_SAVED_MESSAGE, ...newDayNotifications].forEach(
              notification => this.showNotification(notification)
            )
          )
          .catch(e => {
            console.error(e);

            this.showNotification(JSON.stringify(e));
          });
      }
    );
  }

  goToNextView() {
    const { viewList } = this;

    this.setState(({ stageFocus }) => {
      const currentViewIndex = viewList.indexOf(stageFocus);

      return { stageFocus: viewList[(currentViewIndex + 1) % viewList.length] };
    });
  }

  goToPreviousView() {
    const { viewList } = this;

    this.setState(({ stageFocus }) => {
      const currentViewIndex = viewList.indexOf(stageFocus);

      return {
        stageFocus:
          viewList[
            currentViewIndex === 0
              ? viewList.length - 1
              : (currentViewIndex - 1) % viewList.length
          ],
      };
    });
  }

  /**
   * @param {farmhand.item} item
   * @param {number} [howMany=1]
   */
  purchaseItem(item, howMany) {
    this.setState(state => purchaseItem(item, howMany, state));
  }

  /**
   * @param {farmhand.item} item
   */
  purchaseItemMax(item) {
    this.setState(state => {
      const { money, valueAdjustments } = state;

      return purchaseItem(
        item,
        Math.floor(money / getAdjustedItemValue(valueAdjustments, item.id)),
        state
      );
    });
  }

  /**
   * @param {farmhand.item} item
   * @param {number} [howMany=1]
   */
  sellItem({ id }, howMany = 1) {
    if (howMany === 0) {
      return;
    }

    this.setState(({ inventory, money, valueAdjustments }) => {
      const value = getAdjustedItemValue(valueAdjustments, id);
      const totalValue = value * howMany;

      return {
        inventory: decrementItemFromInventory(id, inventory, howMany),
        money: money + totalValue,
      };
    });
  }

  /**
   * @param {farmhand.item} item
   */
  sellAllOfItem(item) {
    const { id } = item;
    const { inventory } = this.state;
    const itemInInventory = inventory.find(item => item.id === id);

    if (!itemInInventory) {
      return;
    }

    this.sellItem(item, itemInInventory.quantity);
  }

  /**
   * @param {farmhand.cow} cow
   */
  purchaseCow(cow) {
    this.setState(({ cowInventory, money, purchasedCowPen }) => {
      const cowValue = getCowValue(cow);
      if (
        money < cowValue ||
        purchasedCowPen === 0 ||
        cowInventory.length >= PURCHASEABLE_COW_PENS.get(purchasedCowPen).cows
      ) {
        return;
      }

      return {
        cowInventory: [...cowInventory, { ...cow }],
        money: money - cowValue,
        cowForSale: generateCow(),
      };
    });
  }

  /**
   * @param {farmhand.cow} cow
   */
  sellCow(cow) {
    this.setState(({ cowInventory, money }) => {
      const cowValue = getCowValue(cow);

      const newCowInventory = [...cowInventory];
      newCowInventory.splice(cowInventory.indexOf(cow), 1);

      return {
        cowInventory: newCowInventory,
        money: money + cowValue,
      };
    });
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {string} plantableItemId
   */
  plantInPlot(x, y, plantableItemId) {
    if (!plantableItemId) {
      return;
    }

    this.setState(({ field, inventory }) => {
      const row = field[y];
      const finalCropItemId = getFinalCropItemIdFromSeedItemId(plantableItemId);

      if (row[x]) {
        // Something is already planted in field[x][y]
        return;
      }

      const newField = modifyFieldPlotAt(field, x, y, () =>
        getCropFromItemId(finalCropItemId)
      );

      const updatedInventory = decrementItemFromInventory(
        plantableItemId,
        inventory
      );

      const selectedItemId = updatedInventory.find(
        ({ id }) => id === plantableItemId
      )
        ? plantableItemId
        : '';

      return {
        field: newField,
        inventory: updatedInventory,
        selectedItemId,
      };
    });
  }

  /**
   * @param {number} x
   * @param {number} y
   */
  fertilizeCrop(x, y) {
    this.setState(({ field, inventory }) => {
      const row = field[y];
      const crop = row[x];

      if (
        !crop ||
        crop.type !== plotContentType.CROP ||
        crop.isFertilized === true
      ) {
        return;
      }

      const updatedInventory = decrementItemFromInventory(
        FERTILIZER_ITEM_ID,
        inventory
      );

      const doFertilizersRemain = updatedInventory.some(
        item => item.id === FERTILIZER_ITEM_ID
      );

      return {
        field: modifyFieldPlotAt(field, x, y, crop => ({
          ...crop,
          isFertilized: true,
        })),
        fieldMode: doFertilizersRemain ? FERTILIZE : OBSERVE,
        inventory: updatedInventory,
        selectedItemId: doFertilizersRemain ? FERTILIZER_ITEM_ID : '',
      };
    });
  }

  /**
   * @param {number} x
   * @param {number} y
   */
  setSprinkler(x, y) {
    this.setState(({ field, hoveredPlotRangeSize, inventory }) => {
      const plot = field[y][x];

      // Only set sprinklers in empty plots
      if (plot !== null) {
        return;
      }

      const updatedInventory = decrementItemFromInventory(
        SPRINKLER_ITEM_ID,
        inventory
      );

      const doSprinklersRemain = updatedInventory.some(
        item => item.id === SPRINKLER_ITEM_ID
      );

      const newField = modifyFieldPlotAt(field, x, y, () =>
        getPlotContentFromItemId(SPRINKLER_ITEM_ID)
      );

      return {
        field: newField,
        hoveredPlotRangeSize: doSprinklersRemain ? hoveredPlotRangeSize : 0,
        fieldMode: doSprinklersRemain ? SET_SPRINKLER : OBSERVE,
        inventory: updatedInventory,
        selectedItemId: doSprinklersRemain ? SPRINKLER_ITEM_ID : '',
      };
    });
  }

  /**
   * @param {number} x
   * @param {number} y
   */
  setScarecrow(x, y) {
    this.setState(({ field, inventory }) => {
      const plot = field[y][x];

      // Only set scarecrows in empty plots
      if (plot !== null) {
        return;
      }

      const updatedInventory = decrementItemFromInventory(
        SCARECROW_ITEM_ID,
        inventory
      );

      const doScarecrowsRemain = updatedInventory.some(
        item => item.id === SCARECROW_ITEM_ID
      );

      const newField = modifyFieldPlotAt(field, x, y, () =>
        getPlotContentFromItemId(SCARECROW_ITEM_ID)
      );

      return {
        field: newField,
        inventory: updatedInventory,
        fieldMode: doScarecrowsRemain ? SET_SCARECROW : OBSERVE,
        selectedItemId: doScarecrowsRemain ? SCARECROW_ITEM_ID : '',
      };
    });
  }

  /**
   * @param {number} x
   * @param {number} y
   */
  harvestPlot(x, y) {
    this.setState(({ inventory, field }) => {
      const row = field[y];
      const crop = row[x];

      if (
        !crop ||
        crop.type !== plotContentType.CROP ||
        getCropLifeStage(crop) !== GROWN
      ) {
        return;
      }

      return {
        field: removeFieldPlotAt(field, x, y),
        inventory: addItemToInventory(itemsMap[crop.itemId], inventory),
      };
    });
  }

  /**
   * @param {number} x
   * @param {number} y
   */
  clearPlot(x, y) {
    this.setState(({ field, inventory }) => {
      const plotContent = field[y][x];

      if (!plotContent) {
        // Nothing planted in field[x][y]
        return;
      }

      const item = itemsMap[plotContent.itemId];

      return {
        field: removeFieldPlotAt(field, x, y),
        inventory: item.isReplantable
          ? addItemToInventory(item, inventory)
          : inventory,
      };
    });
  }

  /**
   * @param {number} x
   * @param {number} y
   */
  waterPlot(x, y) {
    this.setState(({ field }) => {
      const plotContent = field[y][x];

      if (!plotContent || plotContent.type !== plotContentType.CROP) {
        return;
      }

      return {
        field: modifyFieldPlotAt(field, x, y, crop => ({
          ...crop,
          wasWateredToday: true,
        })),
      };
    });
  }

  waterAllPlots() {
    this.setState(({ field }) => {
      return { field: getWateredField(field) };
    });
  }

  /**
   * @param {number} fieldId
   */
  purchaseField(fieldId) {
    this.setState(({ field, money, purchasedField }) => {
      if (purchasedField >= fieldId) {
        return;
      }

      const { columns, price, rows } = PURCHASEABLE_FIELD_SIZES.get(fieldId);

      return {
        purchasedField: fieldId,
        field: new Array(rows)
          .fill(null)
          .map((_, row) =>
            new Array(columns)
              .fill(null)
              .map((_, column) => (field[row] && field[row][column]) || null)
          ),
        money: money - price,
      };
    });
  }

  /**
   * @param {number} cowPenId
   */
  purchaseCowPen(cowPenId) {
    this.setState(({ money, purchasedCowPen }) => {
      if (purchasedCowPen >= cowPenId) {
        return;
      }

      return {
        purchasedCowPen: cowPenId,
        money: money - PURCHASEABLE_COW_PENS.get(cowPenId).price,
      };
    });
  }

  render() {
    const {
      fieldToolInventory,
      handlers,
      hoveredPlotRange,
      keyHandlers,
      keyMap,
      plantableCropInventory,
      playerInventory,
      playerInventoryQuantities,
      viewList,
    } = this;

    // Bundle up the raw state and the computed state into one object to be
    // passed down through the component tree.
    const gameState = {
      ...this.state,
      fieldToolInventory,
      hoveredPlotRange,
      plantableCropInventory,
      playerInventory,
      playerInventoryQuantities,
      viewList,
    };

    return (
      <HotKeys className="hotkeys" keyMap={keyMap} handlers={keyHandlers}>
        <MuiThemeProvider theme={theme}>
          <FarmhandContext.Provider value={{ gameState, handlers }}>
            <div className="Farmhand fill">
              <NotificationSystem />
              <AppBar />
              <Drawer
                {...{
                  className: 'sidebar-wrapper',
                  open: gameState.isMenuOpen,
                  variant: 'persistent',
                  PaperProps: {
                    className: 'sidebar',
                  },
                }}
              >
                <Navigation />
                <ContextPane />
                <DebugMenu />
              </Drawer>
              <Stage />

              {/*
              The .end-day button needs to be at this top level instead of the
              Stage because of scrolling issues in iOS.
              */}
              <Tooltip
                {...{
                  title: 'End the day (shift + c)',
                }}
              >
                <Fab
                  {...{
                    'aria-label': 'End the day',
                    className: 'end-day',
                    color: 'primary',
                    onClick: handlers.handleClickEndDayButton,
                  }}
                >
                  <HotelIcon />
                </Fab>
              </Tooltip>
            </div>
          </FarmhandContext.Provider>
        </MuiThemeProvider>
      </HotKeys>
    );
  }
}
