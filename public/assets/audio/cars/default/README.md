# Default car audio clips

Place the audio files in this folder with these exact names:

- `engine-idle.ogg`
- `engine-load.ogg`
- `tire-skid.ogg`

`engine-load.ogg` should be a continuous rev sweep: start near 850 RPM and reach
the final recorded RPM near 7050 RPM. The game maps the engine RPM to a position
in this recording and plays a short window from that point at the original
playback speed. It does not change the clip's pitch. At the limiter, the load
sound is pulsed to imitate rev limiting.

`engine-idle.ogg` and `tire-skid.ogg` are looped while active, so make those
seamless loops. Keep gear changes, voices, and background music out of these
clips. Missing clips are skipped, so the game remains playable while the audio
set is incomplete. Reload the game after adding or replacing clips.
