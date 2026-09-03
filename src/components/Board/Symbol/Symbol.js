import React, { useState, useRef, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames';
import { isPackagedApp } from '../../../cordova-util';
import OutlinedInput from '@material-ui/core/OutlinedInput';
import messages from '../Board.messages';

import { LABEL_POSITION_BELOW } from '../../Settings/Display/Display.constants';
import './Symbol.css';
import { Typography } from '@material-ui/core';
import { getArasaacDB } from '../../../idb/arasaac/arasaacdb';
import { resolveRemoteImage } from '../../../idb/media/remoteImageLoader';

const propTypes = {
  /**
   * Image to display
   */
  image: PropTypes.string,
  /**
   * Label to display
   */
  label: PropTypes.oneOfType([PropTypes.string, PropTypes.node]).isRequired,
  labelpos: PropTypes.string,
  type: PropTypes.string,
  onWrite: PropTypes.func,
  intl: PropTypes.object,
  /**
   * Keep a remote image on-device so it still renders offline. Opt-in, and only for
   * images already committed to a board: anywhere a user merely browses images
   * (search results, tile editor previews) every image passed through would be
   * stored forever. A tile saved in the editor is cached once the board renders it.
   */
  cacheRemoteImage: PropTypes.bool
};

function formatSrc(src) {
  return isPackagedApp() && src?.startsWith('/') ? `.${src}` : src;
}

const isRemote = (src) => /^https?:\/\//.test(src ?? '');

function Symbol(props) {
  const {
    className,
    label,
    labelpos,
    keyPath,
    type,
    onWrite,
    intl,
    image,
    cacheRemoteImage,
    ...other
  } = props;

  // a remote url is resolved from IndexedDB below; pointing the <img> at the
  // network first costs a request the cache was meant to replace, and offline it
  // paints a broken image before the cached copy swaps in
  const [src, setSrc] = useState(
    image && !isRemote(image) ? formatSrc(image) : ''
  );
  const objectUrlRef = useRef(null);

  const fetchArasaacImagefromIndexedDB = useCallback(async (id) => {
    if (!id) return null;

    try {
      const arasaacDB = getArasaacDB();
      return await arasaacDB.getImageById(id);
    } catch (error) {
      console.error('Failed to fetch Arasaac image from Indexed DB:', error);
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function getSrc() {
      const setBlobSrc = (data, type) => {
        const blob = new Blob([data], { type });
        const url = URL.createObjectURL(blob);
        if (objectUrlRef.current) {
          URL.revokeObjectURL(objectUrlRef.current);
        }
        objectUrlRef.current = url;
        setSrc(url);
      };

      const imageFromIndexedDb = await fetchArasaacImagefromIndexedDB(keyPath);

      if (cancelled) return;

      if (imageFromIndexedDb) {
        setBlobSrc(imageFromIndexedDb.data, imageFromIndexedDb.type);
        return;
      }

      // Serve remote symbol images (e.g. globalsymbols.com) from IndexedDB so they
      // still render offline. Service workers don't run in the Cordova webview,
      // so IndexedDB is the only durable cache on native. Reads are unconditional;
      // only writes need cacheRemoteImage, so images cached earlier keep working.
      if (isRemote(image)) {
        const remoteImage = await resolveRemoteImage(image, cacheRemoteImage);
        if (cancelled) return;

        if (remoteImage) {
          setBlobSrc(remoteImage.data, remoteImage.type);
          return;
        }

        setSrc(formatSrc(image));
        return;
      }

      if (image) {
        setSrc(formatSrc(image));
        return;
      }

      setSrc('');
    }
    getSrc();

    return () => {
      cancelled = true;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [fetchArasaacImagefromIndexedDB, image, keyPath, cacheRemoteImage]);

  const symbolClassName = classNames('Symbol', className);

  const handleKeyPress = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault(); //prevent new line in next textArea
      return;
    }
  };

  return (
    <div className={symbolClassName} image={src} {...other}>
      {props.type === 'live' && (
        <OutlinedInput
          id="outlined-live-input"
          margin="none"
          color="primary"
          variant="filled"
          placeholder={intl.formatMessage(messages.writeAndSay)}
          autoFocus={true}
          multiline
          rows={5}
          value={label}
          onChange={onWrite}
          fullWidth={true}
          onKeyPress={handleKeyPress}
          style={{
            padding: '0.5em 0.8em 0.5em 0.8em',
            height: '100%'
          }}
          className={'liveInput'}
        />
      )}
      {props.type !== 'live' &&
        props.labelpos === 'Above' &&
        props.labelpos !== 'Hidden' && (
          <Typography className="Symbol__label">{label}</Typography>
        )}

      <div className="Symbol__image-container">
        {src && <img className="Symbol__image" src={src} alt="" />}
      </div>

      {props.type !== 'live' &&
        props.labelpos === 'Below' &&
        props.labelpos !== 'Hidden' && (
          <Typography className="Symbol__label">{label}</Typography>
        )}
    </div>
  );
}
Symbol.propTypes = propTypes;
Symbol.defaultProps = {
  labelpos: LABEL_POSITION_BELOW
};

export default Symbol;
